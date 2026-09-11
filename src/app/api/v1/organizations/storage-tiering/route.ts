import { z } from "zod";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import {
  getTieringPolicy,
  summarizeStorageByTier,
  updateTieringPolicy,
} from "@/lib/storage-tiering";

/**
 * Null means "never move objects to this tier". That is distinct from omitting
 * the field, which leaves the stored value alone — a customer disabling only
 * deep archive must be able to say so without restating the other two.
 */
const schema = z.object({
  enabled: z.boolean().optional(),
  infrequentAccessAfterDays: z.number().int().min(0).max(36_500).nullable().optional(),
  archiveAfterDays: z.number().int().min(0).max(36_500).nullable().optional(),
  deepArchiveAfterDays: z.number().int().min(0).max(36_500).nullable().optional(),
});

/**
 * GET /api/v1/organizations/storage-tiering — the policy plus what it has
 * actually done. The per-tier breakdown ships with the policy because the
 * policy alone tells a customer nothing about whether it is saving them
 * anything.
 */
export const GET = withApiHandler(async (ctx) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canViewAuditLogs");
  const [policy, usage] = await Promise.all([
    getTieringPolicy(ctx.organizationId),
    summarizeStorageByTier(ctx.organizationId),
  ]);
  return { policy, usage };
});

/**
 * PUT — changing this moves customer bytes between storage classes and, for
 * deep archive, makes them non-instant to read. That is a billing-shaped
 * decision, so it takes the billing permission rather than a general
 * settings one.
 */
export const PUT = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageBilling");
  return updateTieringPolicy(ctx, schema.parse(await req.json()));
});
