import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { rollbackImport } from "@/lib/import-service";

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/v1/imports/[id]/rollback — undo a completed import (spec §68).
export const POST = withApiHandler<unknown, RouteParams>(async (ctx, _req, { params }) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageProperties");
  const { id } = await params;
  return rollbackImport({ ctx, jobId: id });
});
