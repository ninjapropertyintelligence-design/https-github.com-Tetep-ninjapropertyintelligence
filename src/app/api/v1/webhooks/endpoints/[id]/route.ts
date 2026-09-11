import { z } from "zod";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { deleteEndpoint, setEndpointEnabled } from "@/lib/webhooks";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({ enabled: z.boolean() });

// PATCH — enable/disable. Re-enabling also clears the failure streak.
export const PATCH = withApiHandler<unknown, RouteParams>(async (ctx, req, { params }) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageIntegrations");
  const { id } = await params;
  const { enabled } = schema.parse(await req.json());
  return setEndpointEnabled(ctx, id, enabled);
});

export const DELETE = withApiHandler<unknown, RouteParams>(async (ctx, _req, { params }) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageIntegrations");
  const { id } = await params;
  await deleteEndpoint(ctx, id);
  return { deleted: true };
});
