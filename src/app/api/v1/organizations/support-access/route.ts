import { z } from "zod";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { listSupportAccessHistory, setSupportAccessPolicy } from "@/lib/impersonation";

const schema = z.object({ allowSupportAccess: z.boolean() });

// GET /api/v1/organizations/support-access — who has been in this account.
export const GET = withApiHandler(async (ctx) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canViewAuditLogs");
  return { items: await listSupportAccessHistory(ctx) };
});

// PUT — the customer's own off-switch (spec §45, fifth requirement).
export const PUT = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageTeam");
  const { allowSupportAccess } = schema.parse(await req.json());
  return setSupportAccessPolicy({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    allowSupportAccess,
  });
});
