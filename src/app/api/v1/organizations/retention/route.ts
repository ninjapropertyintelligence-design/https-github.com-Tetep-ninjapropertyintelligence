import { z } from "zod";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { getRetentionPolicy, updateRetentionPolicy } from "@/lib/retention";

// Null means "keep indefinitely" for the active-property window; every other
// field is a positive number of days.
const schema = z.object({
  activePropertyRetentionDays: z.number().int().positive().max(36_500).nullable().optional(),
  deletedPropertyGraceDays: z.number().int().min(0).max(365).optional(),
  deletedOrganizationGraceDays: z.number().int().min(0).max(365).optional(),
  archivedCaptureRetentionDays: z.number().int().positive().max(36_500).optional(),
  customerTerminationGraceDays: z.number().int().min(0).max(365).optional(),
  backupRetentionDays: z.number().int().min(1).max(3650).optional(),
});

// GET /api/v1/organizations/retention — the policy, or the defaults in use.
export const GET = withApiHandler(async (ctx) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canViewAuditLogs");
  return getRetentionPolicy(ctx.organizationId);
});

export const PUT = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageBilling");
  return updateRetentionPolicy(ctx, schema.parse(await req.json()));
});
