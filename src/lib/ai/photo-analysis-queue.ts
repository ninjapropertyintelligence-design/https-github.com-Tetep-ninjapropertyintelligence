import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import type { SessionContext } from "@/lib/tenant-scope";
import { logEvent } from "@/lib/observability";
import { MAX_ANALYZE_BYTES, SUPPORTED_MEDIA_TYPES, runPhotoAnalysis } from "@/lib/ai/photo-analysis";
import { PhotoAnalysisJobStatus, Role } from "@/generated/prisma/client";

/**
 * AUTOMATIC PHOTO ANALYSIS — queued on upload, so a suggestion is already
 * waiting when the vendor opens the job.
 *
 * Only what the AI could actually rate is queued: a vendor's capture-job
 * photo, uploaded against a named asset, of a type and size the providers
 * accept. Anything else keeps the manual "Analyse with AI" button. Queueing
 * never touches a score — it produces SUGGESTED findings, which still need a
 * person to confirm them, exactly like the button.
 *
 * The queue is a table, processed two ways: straight after the upload
 * request responds (Next's `after`), and by a sweep that picks up whatever
 * that missed — a function that hit its time limit, an instance that
 * restarted mid-run. Neither path holds work only in memory.
 */

/** A provider failure is retried this many times in total, then left as FAILED. */
export const MAX_ATTEMPTS = 3;

/** A job RUNNING longer than this was abandoned mid-run; the sweep takes it back. */
export const STALE_RUNNING_MS = 10 * 60 * 1000;

/**
 * Queues every photo in `evidenceIds` that can be analysed automatically.
 * Returns the queued job ids, for the caller to process after responding.
 *
 * Called with the uploader's own session, straight after their upload was
 * accepted. That is the access check for the background run: the photos are
 * ones this vendor just put on a site they were sent to, and the asset was
 * validated against the photo's property when the upload was registered.
 */
export async function enqueueAutoAnalysis(ctx: SessionContext, evidenceIds: string[]): Promise<string[]> {
  if (evidenceIds.length === 0) return [];
  // Capture-job uploads come from vendors; everyone else's photos are their
  // organization's own and are not held in the review queue this feeds.
  if (ctx.role !== Role.VENDOR) return [];

  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { autoAnalyzePhotos: true },
  });
  if (!org?.autoAnalyzePhotos) return [];

  const eligible = await prisma.evidence.findMany({
    where: {
      id: { in: evidenceIds },
      organizationId: ctx.organizationId,
      uploadedById: ctx.userId,
      captureJobSiteId: { not: null },
      assetId: { not: null },
      type: { in: ["PHOTO", "DRONE_IMAGE"] },
      mimeType: { in: SUPPORTED_MEDIA_TYPES },
      OR: [{ sizeBytes: null }, { sizeBytes: { lte: MAX_ANALYZE_BYTES } }],
    },
    select: { id: true, assetId: true },
  });
  if (eligible.length === 0) return [];

  await prisma.photoAnalysisJob.createMany({
    data: eligible.map((e) => ({
      organizationId: ctx.organizationId,
      evidenceId: e.id,
      assetId: e.assetId!,
      requestedById: ctx.userId,
    })),
    // One job per photo, however many times the upload is retried.
    skipDuplicates: true,
  });

  const jobs = await prisma.photoAnalysisJob.findMany({
    where: { evidenceId: { in: eligible.map((e) => e.id) }, status: PhotoAnalysisJobStatus.QUEUED },
    select: { id: true },
  });
  return jobs.map((j) => j.id);
}

export interface ProcessResult {
  done: number;
  retrying: number;
  failed: number;
  skipped: number;
  /** Jobs left for the next run because the time budget ran out. */
  remaining: number;
}

/**
 * Works through the queue, one photo at a time.
 *
 * With `jobIds`, only those (the upload that just happened). Without, it is
 * the sweep: anything QUEUED, plus anything left RUNNING long enough ago that
 * its run must have died. Sequential on purpose — each call is a paid,
 * multi-second vision request, and a burst of 500 at once would trip the
 * provider's rate limit for every organization on the platform.
 *
 * Stops claiming new work once `timeBudgetMs` is spent, so a run inside a
 * request-bound function finishes before the platform kills it; unclaimed
 * jobs simply stay QUEUED for the sweep.
 */
export async function processPhotoAnalysisJobs(
  options: { jobIds?: string[]; limit?: number; timeBudgetMs?: number } = {},
): Promise<ProcessResult> {
  const started = Date.now();
  const limit = options.limit ?? 200;
  const budget = options.timeBudgetMs ?? 50_000;
  const result: ProcessResult = { done: 0, retrying: 0, failed: 0, skipped: 0, remaining: 0 };

  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
  const where = options.jobIds
    ? { id: { in: options.jobIds }, status: PhotoAnalysisJobStatus.QUEUED }
    : {
        OR: [
          { status: PhotoAnalysisJobStatus.QUEUED },
          { status: PhotoAnalysisJobStatus.RUNNING, startedAt: { lt: staleBefore } },
        ],
      };
  const candidates = await prisma.photoAnalysisJob.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (let i = 0; i < candidates.length; i += 1) {
    if (Date.now() - started > budget) {
      result.remaining = candidates.length - i;
      break;
    }
    const job = candidates[i];

    // Claimed atomically on the status it was read with, so the request-time
    // run and a sweep that overlap can never both analyse (and both bill) the
    // same photo.
    const claimed = await prisma.photoAnalysisJob.updateMany({
      where: { id: job.id, status: job.status, updatedAt: job.updatedAt },
      data: { status: PhotoAnalysisJobStatus.RUNNING, startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;
    const attempt = job.attempts + 1;

    try {
      const finding = await runPhotoAnalysis({
        organizationId: job.organizationId,
        evidenceId: job.evidenceId,
        assetId: job.assetId,
        requestedById: job.requestedById,
      });
      await prisma.photoAnalysisJob.update({
        where: { id: job.id },
        data: { status: PhotoAnalysisJobStatus.DONE, findingId: finding.id, lastError: null },
      });
      result.done += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      // A 4xx (the photo or asset cannot be analysed) or 503 (no AI provider
      // configured) will fail the same way every time; retrying would only
      // repeat it. A provider failure (502) or anything unexpected might not.
      const permanent = err instanceof ApiError && (err.status === 503 || (err.status >= 400 && err.status < 500));
      const status = permanent
        ? PhotoAnalysisJobStatus.SKIPPED
        : attempt >= MAX_ATTEMPTS
          ? PhotoAnalysisJobStatus.FAILED
          : PhotoAnalysisJobStatus.QUEUED;
      await prisma.photoAnalysisJob.update({ where: { id: job.id }, data: { status, lastError: message.slice(0, 500) } });
      if (status === PhotoAnalysisJobStatus.SKIPPED) result.skipped += 1;
      else if (status === PhotoAnalysisJobStatus.FAILED) result.failed += 1;
      else result.retrying += 1;
      logEvent("ai.photo_analysis_job", {
        ok: false,
        organizationId: job.organizationId,
        jobId: job.id,
        attempt,
        outcome: status,
        errorMessage: message,
      });
    }
  }

  return result;
}
