import { NextResponse } from "next/server";
import { processPhotoAnalysisJobs } from "@/lib/ai/photo-analysis-queue";
import { isCronAuthorized } from "@/lib/cron-auth";

export const maxDuration = 300;

/**
 * GET /api/v1/cron/photo-analysis — the scheduled sweep of the photo
 * analysis queue.
 *
 * Most photos are analysed straight after their upload responds. This picks
 * up the rest: uploads whose run hit its time limit, runs whose instance went
 * away mid-photo (RUNNING for longer than STALE_RUNNING_MS), and retries of
 * provider failures. Same work as POST /api/v1/admin/photo-analysis/run,
 * authenticated with CRON_SECRET instead of a platform-admin session.
 *
 * The time budget stays well inside maxDuration, so the function returns
 * before the platform cuts it off; anything left waits for the next run.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ data: null, error: "Unauthorized", meta: {} }, { status: 401 });
  }
  const result = await processPhotoAnalysisJobs({ limit: 500, timeBudgetMs: 240_000 });
  return NextResponse.json({ data: result, error: null, meta: {} });
}
