import { z } from "zod";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import {
  summarizeActiveUsers,
  summarizeFeatureAdoption,
  summarizeRetention,
} from "@/lib/analytics";

/**
 * GET /api/v1/organizations/analytics?periodStart=&periodEnd=&weeks=
 *
 * Product analytics for one organization (spec §105): feature adoption,
 * active users, retention cohorts. Defaults to the last 30 days.
 *
 * Every figure here excludes support impersonation (§45) — see the rules at
 * the top of src/lib/analytics.ts — and reports the window it could actually
 * observe, so a short tracking history reads as "not tracked yet" rather
 * than as a confident zero.
 */
const schema = z.object({
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
  weeks: z.coerce.number().int().min(1).max(52).optional(),
});

export const GET = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  // Usage data describes the organization's own people, so it sits behind the
  // same permission as the audit trail rather than being broadly readable.
  requirePermission(ctx, "canViewAuditLogs");

  const url = new URL(req.url);
  const parsed = schema.parse({
    periodStart: url.searchParams.get("periodStart") ?? undefined,
    periodEnd: url.searchParams.get("periodEnd") ?? undefined,
    weeks: url.searchParams.get("weeks") ?? undefined,
  });
  const periodEnd = parsed.periodEnd ?? new Date();
  const periodStart =
    parsed.periodStart ?? new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [adoption, activeUsers, retention] = await Promise.all([
    summarizeFeatureAdoption(ctx.organizationId, periodStart, periodEnd),
    summarizeActiveUsers(ctx.organizationId, periodEnd),
    summarizeRetention(ctx.organizationId, parsed.weeks ?? 8, periodEnd),
  ]);

  return { adoption, activeUsers, retention };
});
