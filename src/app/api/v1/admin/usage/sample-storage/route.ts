import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { sampleStorageUsage } from "@/lib/cost-metering";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  /**
   * How long this sample covers — i.e. how long since the last run. Required
   * rather than assumed: it scales the entire storage line linearly, and a
   * wrong default would silently misprice every organization at once.
   */
  intervalDays: z.number().positive().max(366),
});

/**
 * POST /api/v1/admin/usage/sample-storage — accrue GB-months for every
 * organization's current stored bytes (spec §49).
 *
 * Storage is a level, not an event: bytes cost money for as long as they sit
 * there, so the only way to meter them is to sample periodically. A scheduler
 * calling this on a fixed cadence is a deployment concern; exposing it as an
 * endpoint keeps the behaviour operable and testable today.
 */
export const POST = withApiHandler(async (ctx, req) => {
  if (!ctx.isPlatformAdmin) throw new ApiError(403, "Platform admin only");
  const { intervalDays } = schema.parse(await req.json());

  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let sampled = 0;
  for (const org of orgs) {
    const result = await sampleStorageUsage(org.id, intervalDays);
    sampled += result.sampled;
  }
  return { organizationsProcessed: orgs.length, recordsWritten: sampled, intervalDays };
});
