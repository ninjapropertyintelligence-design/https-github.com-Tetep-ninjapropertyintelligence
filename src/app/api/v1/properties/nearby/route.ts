import { z } from "zod";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { METERS_PER_MILE, findNearestProperties, findPropertiesWithinRadius } from "@/lib/spatial";

/**
 * GET /api/v1/properties/nearby?latitude=&longitude=&radiusMiles=&limit=
 *
 * Properties near a point (spec §11). With `radiusMiles`, everything inside
 * that radius; without it, the nearest `limit` properties at any distance.
 *
 * Miles on the wire, metres internally: the underlying column is `geography`
 * so distances are true metres, and the conversion happens once here rather
 * than being re-derived by every caller.
 */
const schema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMiles: z.coerce.number().positive().max(12_000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canViewPortfolio");

  const url = new URL(req.url);
  const input = schema.parse({
    latitude: url.searchParams.get("latitude"),
    longitude: url.searchParams.get("longitude"),
    radiusMiles: url.searchParams.get("radiusMiles") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  const result =
    input.radiusMiles === undefined
      ? await findNearestProperties(ctx, {
          latitude: input.latitude,
          longitude: input.longitude,
          limit: input.limit,
        })
      : await findPropertiesWithinRadius(ctx, {
          latitude: input.latitude,
          longitude: input.longitude,
          radiusMeters: input.radiusMiles * METERS_PER_MILE,
          limit: input.limit,
        });

  return {
    ...result,
    properties: result.properties.map((p) => ({
      ...p,
      distanceMiles: p.distanceMeters === null ? null : p.distanceMeters / METERS_PER_MILE,
    })),
  };
});
