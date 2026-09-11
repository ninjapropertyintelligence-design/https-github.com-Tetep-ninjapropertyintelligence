import { ApiError, withApiHandler } from "@/lib/api-utils";
import { runDueTiering } from "@/lib/storage-tiering";

/**
 * POST /api/v1/admin/storage-tiering/run — evaluate every opted-in
 * organization's objects and move the ones that have aged past a threshold.
 *
 * Exposed as an endpoint for the same reason as the retention runner: it makes
 * the job operable and testable now, and leaves "what calls it on a timer" as
 * a deployment concern. Platform-admin only — it acts across organizations,
 * and a transition to deep archive is not free to undo.
 */
export const POST = withApiHandler(async (ctx) => {
  if (!ctx.isPlatformAdmin) throw new ApiError(403, "Platform admin only");
  const results = await runDueTiering();
  return {
    organizationsProcessed: results.length,
    transitioned: results.reduce((n, r) => n + r.transitioned, 0),
    failed: results.reduce((n, r) => n + r.failed, 0),
    results,
  };
});
