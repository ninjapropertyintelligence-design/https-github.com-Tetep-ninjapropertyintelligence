import { ApiError, withApiHandler } from "@/lib/api-utils";
import { summarizeActivation } from "@/lib/analytics";

/**
 * GET /api/v1/admin/analytics/activation — the activation funnel across every
 * organization on the platform (spec §105).
 *
 * Platform-admin only: it spans tenants by design, which is exactly what no
 * customer-facing route is allowed to do.
 */
export const GET = withApiHandler(async (ctx) => {
  if (!ctx.isPlatformAdmin) throw new ApiError(403, "Platform admin only");
  return summarizeActivation();
});
