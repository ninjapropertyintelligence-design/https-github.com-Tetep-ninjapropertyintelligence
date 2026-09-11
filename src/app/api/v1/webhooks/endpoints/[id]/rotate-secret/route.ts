import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { rotateSecret } from "@/lib/webhooks";

type RouteParams = { params: Promise<{ id: string }> };

// POST — issue a new signing secret. Returned once; the old one stops
// working immediately, so the integrator updates their side promptly.
export const POST = withApiHandler<unknown, RouteParams>(async (ctx, _req, { params }) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageIntegrations");
  const { id } = await params;
  return rotateSecret(ctx, id);
});
