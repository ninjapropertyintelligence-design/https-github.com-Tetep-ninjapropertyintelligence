import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { cancelDeletionRequest } from "@/lib/retention";

type RouteParams = { params: Promise<{ id: string }> };

// DELETE — cancel a scheduled deletion during its grace window.
export const DELETE = withApiHandler<unknown, RouteParams>(async (ctx, _req, { params }) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageProperties");
  const { id } = await params;
  return cancelDeletionRequest(ctx, id);
});
