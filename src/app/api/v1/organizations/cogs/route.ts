import { z } from "zod";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { summarizePropertyCogs } from "@/lib/cost-metering";

/**
 * GET /api/v1/organizations/cogs?periodStart=&periodEnd=
 *
 * Cost of serving each property over a period (spec §50). Defaults to the
 * last 30 days when no window is given.
 */
const schema = z.object({
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
});

export const GET = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  // Cost-to-serve is commercially sensitive: it is what the business pays to
  // run a property, not what the customer is charged.
  requirePermission(ctx, "canViewFinancialExposure");

  const url = new URL(req.url);
  const parsed = schema.parse({
    periodStart: url.searchParams.get("periodStart") ?? undefined,
    periodEnd: url.searchParams.get("periodEnd") ?? undefined,
  });
  const periodEnd = parsed.periodEnd ?? new Date();
  const periodStart =
    parsed.periodStart ?? new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  return summarizePropertyCogs(ctx.organizationId, periodStart, periodEnd);
});
