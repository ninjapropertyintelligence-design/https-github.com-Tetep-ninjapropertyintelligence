import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";

/**
 * POSTGIS SPATIAL QUERIES (spec §11).
 *
 * Prisma has no geography type, so every query here is raw SQL. That is the
 * dangerous part of this file, and the design is shaped almost entirely
 * around containing it:
 *
 * SECURITY. `propertyScopeWhere` is the one authority on which properties a
 * session may see, and it is not simple — organization, plus for scoped roles
 * an OR across portfolio/region/property grants that denies by default.
 * Reimplementing that in SQL would put the access rule in two languages, and
 * the copy would drift the first time someone edited the original. So the
 * spatial query does the geometry (filtered by organizationId, the coarse
 * tenant boundary, which is unambiguous in SQL) and hands back candidate IDs;
 * Prisma then applies the real scope to those IDs. One authority, still.
 *
 * TRUNCATION. Candidates are capped, because a huge radius over a large
 * portfolio would otherwise pull an unbounded ID list into memory. When the
 * cap is hit the result says so rather than presenting a partial answer as a
 * complete one.
 *
 * UNITS. Distances are metres, always, because the column is `geography`.
 * On `geometry` the same functions return DEGREES, which is not a distance at
 * all — see the migration comment.
 *
 * INDEXABILITY. Radius filtering uses ST_DWithin, which the GiST index can
 * serve. `ST_Distance(...) < x` returns the same rows and cannot use the
 * index, so it degrades to a full scan; that substitution is the easiest way
 * to quietly ruin this file's performance.
 */

/**
 * Upper bound on candidate rows pulled from a spatial query before scoping.
 * Generous enough that no realistic portfolio hits it, small enough that a
 * pathological request cannot exhaust memory.
 */
const MAX_CANDIDATES = 5_000;

/**
 * Overrides the candidate cap. Tests only.
 *
 * The cap is what makes the SQL-level `organizationId` filter matter. Prisma
 * is the security authority, so removing that filter leaks nothing — but the
 * cap would then be spent on other tenants' rows, and a caller would get a
 * silently incomplete answer on a busy database. That failure only appears
 * above 5,000 candidate rows, which is not reachable in a test, so the cap is
 * made injectable rather than left unverified.
 */
export interface InternalLimits {
  maxCandidates?: number;
}

/** Half the Earth's circumference; any radius beyond this is a whole-globe query. */
const MAX_RADIUS_METERS = 20_037_508;

export const METERS_PER_MILE = 1609.344;

export interface SpatialProperty {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** Great-circle distance in metres from the query point, when there is one. */
  distanceMeters: number | null;
}

export interface SpatialResult {
  properties: SpatialProperty[];
  /**
   * True when the candidate cap was reached, so results are a subset of what
   * matched. A caller showing a count must not present this as the total.
   */
  truncated: boolean;
}

function assertLatitude(value: number, label: string): void {
  if (!Number.isFinite(value) || value < -90 || value > 90) {
    throw new ApiError(422, `${label} must be a latitude between -90 and 90`);
  }
}

function assertLongitude(value: number, label: string): void {
  if (!Number.isFinite(value) || value < -180 || value > 180) {
    throw new ApiError(422, `${label} must be a longitude between -180 and 180`);
  }
}

/**
 * Applies the real access rule to candidate IDs and returns them in the order
 * the spatial query produced (Postgres does not preserve an `IN` list's
 * order, and for a nearest-first query the order IS the answer).
 */
async function scopeAndOrder(
  ctx: SessionContext,
  candidates: Array<{ id: string; distance_meters: number | null }>,
  limit: number,
): Promise<SpatialProperty[]> {
  if (candidates.length === 0) return [];

  const permitted = await prisma.property.findMany({
    where: { AND: [{ id: { in: candidates.map((c) => c.id) } }, propertyScopeWhere(ctx)] },
    select: { id: true, name: true, latitude: true, longitude: true },
  });
  const byId = new Map(permitted.map((p) => [p.id, p]));

  const out: SpatialProperty[] = [];
  for (const candidate of candidates) {
    const row = byId.get(candidate.id);
    if (!row) continue; // Not visible to this session.
    out.push({
      id: row.id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      distanceMeters:
        candidate.distance_meters === null ? null : Number(candidate.distance_meters),
    });
    // Limited AFTER scoping: limiting the spatial step would let properties
    // the session cannot see consume slots and silently shorten the answer.
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The radius predicate, exported so a test can EXPLAIN the query this code
 * actually runs.
 *
 * ST_DWithin and `ST_Distance(...) < r` return identical rows, so no
 * behavioural test distinguishes them — but only ST_DWithin can use the GiST
 * index, and substituting the other silently turns every radius search into a
 * full table scan. Asserting on a copy of the SQL in the test file would
 * prove only that PostGIS works; the predicate has to be shared to prove that
 * THIS query is indexable.
 */
export function radiusPredicate(
  longitude: number,
  latitude: number,
  radiusMeters: number,
): Prisma.Sql {
  const point = `SRID=4326;POINT(${longitude} ${latitude})`;
  return Prisma.sql`ST_DWithin("geo", ${point}::geography, ${radiusMeters})`;
}

export interface RadiusQuery {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  limit?: number;
}

/**
 * Properties within a radius of a point, nearest first (spec §11).
 */
export async function findPropertiesWithinRadius(
  ctx: SessionContext,
  query: RadiusQuery,
  internal: InternalLimits = {},
): Promise<SpatialResult> {
  const cap = internal.maxCandidates ?? MAX_CANDIDATES;
  assertLatitude(query.latitude, "latitude");
  assertLongitude(query.longitude, "longitude");
  if (!Number.isFinite(query.radiusMeters) || query.radiusMeters <= 0) {
    throw new ApiError(422, "Radius must be a positive number of metres");
  }
  if (query.radiusMeters > MAX_RADIUS_METERS) {
    throw new ApiError(422, "Radius is larger than the Earth; narrow the search");
  }
  const limit = query.limit ?? 100;

  const candidates = await prisma.$queryRaw<Array<{ id: string; distance_meters: number | null }>>(
    Prisma.sql`
      SELECT id, ST_Distance("geo", ${`SRID=4326;POINT(${query.longitude} ${query.latitude})`}::geography) AS distance_meters
      FROM "Property"
      WHERE "organizationId" = ${ctx.organizationId}
        AND "geo" IS NOT NULL
        AND ${radiusPredicate(query.longitude, query.latitude, query.radiusMeters)}
      ORDER BY distance_meters ASC
      LIMIT ${cap}
    `,
  );

  return {
    properties: await scopeAndOrder(ctx, candidates, limit),
    truncated: candidates.length >= cap,
  };
}

export interface BoundsQuery {
  north: number;
  south: number;
  east: number;
  west: number;
  limit?: number;
}

/**
 * Properties inside a viewport (spec §11).
 *
 * This is what makes the portfolio map scale: it asks the database for the
 * markers in view instead of fetching every property and discarding most of
 * them in the browser.
 *
 * A box crossing the antimeridian (west > east) needs no special handling,
 * which is worth stating because the opposite is widely assumed. On
 * `geometry`, ST_MakeEnvelope with xmin > xmax does misbehave. On
 * `geography` the polygon's edges are geodesics, so PostGIS takes the
 * shorter way round and produces exactly the intended box: verified against
 * Fiji (178) and Samoa (-172) inside, Tokyo (139) and New York (-74)
 * outside, with results identical to splitting it into two envelopes.
 *
 * A box spanning 180 degrees of longitude or more is a different matter, and
 * it is NOT hypothetical — it is what a map zoomed fully out sends. Such a
 * box has an edge joining two antipodal points, between which no geodesic is
 * shorter than any other, and PostGIS refuses it outright:
 * "Antipodal (180 degrees long) edge detected!". Passed through, that
 * surfaced as a 500 on the most ordinary map interaction there is.
 *
 * Handled by dropping the longitude constraint and filtering on the latitude
 * band alone, which is exactly what such a box means: every longitude. That
 * is the honest reading of the request rather than an error the caller can do
 * nothing about.
 */
export async function findPropertiesInBounds(
  ctx: SessionContext,
  query: BoundsQuery,
  internal: InternalLimits = {},
): Promise<SpatialResult> {
  const cap = internal.maxCandidates ?? MAX_CANDIDATES;
  assertLatitude(query.north, "north");
  assertLatitude(query.south, "south");
  assertLongitude(query.east, "east");
  assertLongitude(query.west, "west");
  if (query.north <= query.south) {
    throw new ApiError(422, "The north edge must be above the south edge");
  }
  const limit = query.limit ?? 500;

  /**
   * Longitude span, accounting for a box that wraps the antimeridian
   * (west > east), where the span is the short way round rather than
   * `east - west`.
   */
  const longitudeSpan =
    query.west > query.east ? 360 - (query.west - query.east) : query.east - query.west;
  const spansAllLongitudes = longitudeSpan >= 180;


  const candidates = await prisma.$queryRaw<Array<{ id: string; distance_meters: number | null }>>(
    Prisma.sql`
      SELECT id, NULL::double precision AS distance_meters
      FROM "Property"
      WHERE "organizationId" = ${ctx.organizationId}
        AND "geo" IS NOT NULL
        AND ${
          spansAllLongitudes
            ? // Every longitude: filter the latitude band only. An envelope
              // this wide has an antipodal edge and PostGIS rejects it.
              Prisma.sql`"latitude" BETWEEN ${query.south} AND ${query.north}`
            : Prisma.sql`ST_Intersects("geo", ST_MakeEnvelope(${query.west}, ${query.south}, ${query.east}, ${query.north}, 4326)::geography)`
        }
      ORDER BY name ASC
      LIMIT ${cap}
    `,
  );

  return {
    properties: await scopeAndOrder(ctx, candidates, limit),
    truncated: candidates.length >= cap,
  };
}

/**
 * The N nearest properties to a point, with no radius limit (spec §11).
 *
 * Ordered by the `<->` KNN operator, which the GiST index serves directly —
 * an ORDER BY ST_Distance would sort correctly but compute the distance for
 * every row in the organization first.
 */
export async function findNearestProperties(
  ctx: SessionContext,
  query: { latitude: number; longitude: number; limit?: number },
): Promise<SpatialResult> {
  assertLatitude(query.latitude, "latitude");
  assertLongitude(query.longitude, "longitude");
  const limit = Math.min(query.limit ?? 10, 200);
  const point = `SRID=4326;POINT(${query.longitude} ${query.latitude})`;

  /**
   * Over-fetches deliberately. The KNN ordering happens before the access
   * scope is applied, so asking for exactly `limit` rows would return fewer
   * than `limit` visible properties whenever any of the nearest are ones this
   * session cannot see.
   */
  const fetch = Math.min(limit * 10, MAX_CANDIDATES);

  const candidates = await prisma.$queryRaw<Array<{ id: string; distance_meters: number | null }>>(
    Prisma.sql`
      SELECT id, ST_Distance("geo", ${point}::geography) AS distance_meters
      FROM "Property"
      WHERE "organizationId" = ${ctx.organizationId}
        AND "geo" IS NOT NULL
      ORDER BY "geo" <-> ${point}::geography
      LIMIT ${fetch}
    `,
  );

  return {
    properties: await scopeAndOrder(ctx, candidates, limit),
    truncated: candidates.length >= fetch,
  };
}

/** Metres -> miles, for display. */
export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}
