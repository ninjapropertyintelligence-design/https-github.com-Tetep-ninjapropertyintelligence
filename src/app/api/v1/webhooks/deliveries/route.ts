import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { listDeliveries } from "@/lib/webhooks";

// GET /api/v1/webhooks/deliveries?endpointId=… — the delivery log, so
// "did you send it?" has an answer.
export const GET = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageIntegrations");
  const endpointId = new URL(req.url).searchParams.get("endpointId") ?? undefined;
  return { items: await listDeliveries(ctx, endpointId) };
});
