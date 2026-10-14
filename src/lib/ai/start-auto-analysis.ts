import { after } from "next/server";
import type { SessionContext } from "@/lib/tenant-scope";
import { enqueueAutoAnalysis, processPhotoAnalysisJobs } from "@/lib/ai/photo-analysis-queue";
import { logEvent } from "@/lib/observability";

/**
 * Queues an upload's photos for automatic analysis and starts on them once
 * the response has gone out, so the vendor's upload is not held up by
 * several seconds of AI per photo.
 *
 * Route handlers only: `after` needs a request to attach to. Kept out of the
 * queue module so that module stays callable from tests and scripts.
 *
 * Never throws into the upload. The photos are registered by the time this
 * runs; failing to queue analysis must not turn a successful upload into an
 * error the vendor retries.
 */
export async function startAutoAnalysis(ctx: SessionContext, evidenceIds: string[]): Promise<void> {
  let jobIds: string[];
  try {
    jobIds = await enqueueAutoAnalysis(ctx, evidenceIds);
  } catch (err) {
    logEvent("ai.photo_analysis_job", {
      ok: false,
      organizationId: ctx.organizationId,
      stage: "enqueue",
      errorMessage: err instanceof Error ? err.message : "unknown",
    });
    return;
  }
  if (jobIds.length === 0) return;
  after(async () => {
    try {
      await processPhotoAnalysisJobs({ jobIds });
    } catch (err) {
      // Whatever this run did not finish stays queued for the sweep.
      logEvent("ai.photo_analysis_job", {
        ok: false,
        organizationId: ctx.organizationId,
        stage: "after-upload",
        errorMessage: err instanceof Error ? err.message : "unknown",
      });
    }
  });
}
