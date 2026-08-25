import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { listDeletionRequests } from "@/lib/retention";

export const GET = withApiHandler(async (ctx) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canViewAuditLogs");
  return { items: await listDeletionRequests(ctx) };
});
