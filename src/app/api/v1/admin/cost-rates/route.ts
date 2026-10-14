import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { setRate } from "@/lib/cost-metering";
import { prisma } from "@/lib/prisma";
import { UsageMetricType } from "@/generated/prisma/client";

const schema = z.object({
  /** Null sets the platform-wide default rate. */
  organizationId: z.string().nullable(),
  metricType: z.nativeEnum(UsageMetricType),
  unitCostMicros: z.number().int().min(0),
  currency: z.string().length(3).optional(),
  effectiveFrom: z.coerce.date(),
  note: z.string().max(500).optional(),
});

/**
 * Rate card administration (spec §50). Platform-admin only: these are the
 * business's own input costs, not customer-facing pricing, and a rate set
 * here changes what every cost report in the system reports.
 */
export const GET = withApiHandler(async (ctx) => {
  if (!ctx.isPlatformAdmin) throw new ApiError(403, "Platform admin only");
  return prisma.costRate.findMany({
    orderBy: [{ metricType: "asc" }, { effectiveFrom: "desc" }],
    take: 500,
  });
});

/**
 * POST adds a new rate VERSION — it never edits an existing row. Correcting a
 * rate means superseding it, so a report for a past period keeps pricing that
 * period at the rate which actually applied to it.
 */
export const POST = withApiHandler(async (ctx, req) => {
  if (!ctx.isPlatformAdmin) throw new ApiError(403, "Platform admin only");
  return setRate(ctx, schema.parse(await req.json()));
});
