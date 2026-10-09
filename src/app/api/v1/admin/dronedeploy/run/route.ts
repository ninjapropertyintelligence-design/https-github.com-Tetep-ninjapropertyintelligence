import { ApiError, withApiHandler } from "@/lib/api-utils";
import { runDueDroneDeployImports } from "@/lib/dronedeploy-import-service";

export const maxDuration = 300;

/**
 * POST /api/v1/admin/dronedeploy/run — one import pass over every connected
 * organization. Platform-admin only, like the retention and tiering runners:
 * it acts across organizations. The scheduled path is /api/v1/cron/dronedeploy.
 */
export const POST = withApiHandler(async (ctx) => {
  if (!ctx.isPlatformAdmin) throw new ApiError(403, "Platform admin only");
  const results = await runDueDroneDeployImports();
  return { organizationsProcessed: results.length, results };
});
