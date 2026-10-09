import { ApiError, withApiHandler } from "@/lib/api-utils";
import { processPhotoAnalysisJobs } from "@/lib/ai/photo-analysis-queue";

/**
 * POST /api/v1/admin/photo-analysis/run — work through queued photo analyses.
 *
 * The sweep behind automatic analysis: picks up photos the upload request
 * did not finish (it ran out of time, or its instance went away) and runs
 * retries. Exposed as an endpoint, like webhook delivery, so it is operable
 * and testable before a scheduler exists; pointing cron at it is a
 * deployment concern. Platform-admin only: it spends AI calls on behalf of
 * every organization.
 */
export const POST = withApiHandler(async (ctx) => {
  if (!ctx.isPlatformAdmin) throw new ApiError(403, "Platform admin only");
  return processPhotoAnalysisJobs();
});
