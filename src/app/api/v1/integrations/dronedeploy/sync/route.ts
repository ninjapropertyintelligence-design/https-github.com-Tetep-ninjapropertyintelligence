import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { runDroneDeployImportForOrganization } from "@/lib/dronedeploy-import-service";

// A pass can stream several large exports; give it the room the platform allows.
export const maxDuration = 300;

// POST /api/v1/integrations/dronedeploy/sync — run one import pass for this
// organization now, instead of waiting for the scheduled one.
export const POST = withApiHandler(async (ctx) => {
  requirePermission(ctx, "canManageDroneJobs");
  const result = await runDroneDeployImportForOrganization(ctx.organizationId);
  if (result.skipped === "not connected") throw new ApiError(400, "DroneDeploy is not connected");
  return result;
});
