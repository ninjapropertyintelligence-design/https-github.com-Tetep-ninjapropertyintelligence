import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { releaseLegalHold } from "@/lib/retention";

type RouteParams = { params: Promise<{ id: string }> };

// DELETE — releases the hold. The row is kept (with releasedAt set) rather
// than removed: when a hold was in force, and who lifted it, is exactly what
// gets asked about later.
export const DELETE = withApiHandler<unknown, RouteParams>(async (ctx, _req, { params }) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageBilling");
  const { id } = await params;
  return releaseLegalHold(ctx, id);
});
