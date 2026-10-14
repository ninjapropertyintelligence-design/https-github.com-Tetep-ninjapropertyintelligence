import { z } from "zod";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { findPropertiesInBounds } from "@/lib/spatial";

/**
 * GET /api/v1/properties/in-bounds?north=&south=&east=&west=&limit=
 *
 * Properties inside a map viewport (spec §11). This is what lets the map
 * scale: it asks the database for the markers in view rather than shipping
 * every property to the browser and discarding most of them there.
 *
 * `west > east` is accepted and means a box crossing the antimeridian, which
 * is the convention mapping clients use.
 */
const schema = z.object({
  north: z.coerce.number().min(-90).max(90),
  south: z.coerce.number().min(-90).max(90),
  east: z.coerce.number().min(-180).max(180),
  west: z.coerce.number().min(-180).max(180),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

export const GET = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canViewPortfolio");

  const url = new URL(req.url);
  return findPropertiesInBounds(
    ctx,
    schema.parse({
      north: url.searchParams.get("north"),
      south: url.searchParams.get("south"),
      east: url.searchParams.get("east"),
      west: url.searchParams.get("west"),
      limit: url.searchParams.get("limit") ?? undefined,
    }),
  );
});
