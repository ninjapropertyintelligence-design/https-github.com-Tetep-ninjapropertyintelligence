import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { replayDelivery } from "@/lib/webhooks";

type RouteParams = { params: Promise<{ id: string }> };

// POST — re-queue a delivery. The delivery id is unchanged, so a receiver
// that deduped the first attempt will dedupe this one too (spec §65).
export const POST = withApiHandler<unknown, RouteParams>(async (ctx, _req, { params }) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageIntegrations");
  const { id } = await params;
  return replayDelivery(ctx, id);
});
