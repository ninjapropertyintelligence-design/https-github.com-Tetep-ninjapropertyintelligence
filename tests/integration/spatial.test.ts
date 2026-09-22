import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { Role, AccessScopeType } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import {
  METERS_PER_MILE,
  radiusPredicate,
  findNearestProperties,
  findPropertiesInBounds,
  findPropertiesWithinRadius,
  metersToMiles,
} from "@/lib/spatial";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * PostGIS spatial queries (§11) against real Postgres with the extension.
 *
 * Two classes of case dominate. First, tenant isolation: every query here is
 * raw SQL, which bypasses the Prisma access layer the rest of the app relies
 * on, so a leak would be invisible to every other test in the suite. Second,
 * the silent-wrongness bugs specific to geospatial work — swapped lat/lng,
 * degrees mistaken for metres, and an antimeridian box that inverts to cover
 * most of the planet instead of erroring.
 */

const suffix = `sp${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let orgA: { id: string };
let orgB: { id: string };
let user: { id: string };
let regionNorth: { id: string };
let regionSouth: { id: string };

// Real coordinates, so distances can be checked against known values.
const NYC = { latitude: 40.7128, longitude: -74.006 };
const LA = { latitude: 34.0522, longitude: -118.2437 };
/** Published great-circle distance NYC -> LA, ~3,944 km. */
const NYC_TO_LA_METERS = 3_944_422;

const ids: Record<string, string> = {};

function ctxFor(
  orgId: string,
  role: Role = Role.OWNER,
  grants: SessionContext["grants"] = [],
): SessionContext {
  return {
    userId: user.id,
    userName: "SP User",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: orgId,
    organizationName: "SP Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants,
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

async function makeProperty(
  orgId: string,
  portfolioId: string,
  name: string,
  coords: { latitude: number; longitude: number } | null,
  regionId?: string,
) {
  const p = await prisma.property.create({
    data: {
      organizationId: orgId,
      portfolioId,
      regionId: regionId ?? null,
      name,
      addressLine1: "1 Main St",
      city: "Testville",
      state: "TX",
      postalCode: "75001",
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
    },
  });
  ids[name] = p.id;
  return p;
}

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: `SP A ${suffix}`, slug: `sp-a-${suffix}` } });
  orgB = await prisma.organization.create({ data: { name: `SP B ${suffix}`, slug: `sp-b-${suffix}` } });
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "SP" } });

  const pfA = await prisma.portfolio.create({ data: { organizationId: orgA.id, name: "PA" } });
  const pfB = await prisma.portfolio.create({ data: { organizationId: orgB.id, name: "PB" } });
  regionNorth = await prisma.region.create({ data: { portfolioId: pfA.id, name: "North" } });
  regionSouth = await prisma.region.create({ data: { portfolioId: pfA.id, name: "South" } });

  // Org A: one in NYC (north region), one in LA (south region), one with no coords.
  await makeProperty(orgA.id, pfA.id, `A-NYC-${suffix}`, NYC, regionNorth.id);
  await makeProperty(orgA.id, pfA.id, `A-LA-${suffix}`, LA, regionSouth.id);
  await makeProperty(orgA.id, pfA.id, `A-NOCOORDS-${suffix}`, null, regionNorth.id);
  // Org B: also in NYC. This is the row a tenant leak would surface.
  await makeProperty(orgB.id, pfB.id, `B-NYC-${suffix}`, NYC);
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: orgA.id } });
  await prisma.organization.delete({ where: { id: orgB.id } });
});

describe("the geography column itself", () => {
  it("stores longitude as X and latitude as Y", async () => {
    // ST_MakePoint takes (X, Y) = (lng, lat). Swapping them is the classic
    // GIS bug: it fails silently and puts the point in the wrong hemisphere.
    const [row] = await prisma.$queryRaw<Array<{ lon: number; lat: number }>>`
      SELECT ST_X(geo::geometry) AS lon, ST_Y(geo::geometry) AS lat
      FROM "Property" WHERE id = ${ids[`A-NYC-${suffix}`]}`;
    expect(row.lon).toBeCloseTo(NYC.longitude, 6);
    expect(row.lat).toBeCloseTo(NYC.latitude, 6);
  });

  it("measures in metres, not degrees", async () => {
    // On `geometry` the same call returns ~44.74 — degrees, which is not a
    // distance. Only `geography` gives a real spheroidal measurement.
    const [row] = await prisma.$queryRaw<Array<{ m: number }>>`
      SELECT ST_Distance(
        (SELECT geo FROM "Property" WHERE id = ${ids[`A-NYC-${suffix}`]}),
        (SELECT geo FROM "Property" WHERE id = ${ids[`A-LA-${suffix}`]})
      ) AS m`;
    expect(Number(row.m)).toBeGreaterThan(NYC_TO_LA_METERS * 0.999);
    expect(Number(row.m)).toBeLessThan(NYC_TO_LA_METERS * 1.001);
  });

  it("is kept in sync by the database, not by application code", async () => {
    const pf = await prisma.portfolio.findFirstOrThrow({ where: { organizationId: orgA.id } });
    const p = await prisma.property.create({
      data: {
        organizationId: orgA.id, portfolioId: pf.id, name: `sync-${suffix}`,
        addressLine1: "1 A", city: "C", state: "TX", postalCode: "75001",
        latitude: NYC.latitude, longitude: NYC.longitude,
      },
    });
    const after = async () =>
      (await prisma.$queryRaw<Array<{ lon: number | null }>>`
        SELECT ST_X(geo::geometry) AS lon FROM "Property" WHERE id = ${p.id}`)[0];

    expect((await after()).lon).toBeCloseTo(NYC.longitude, 6);

    await prisma.property.update({ where: { id: p.id }, data: { longitude: LA.longitude, latitude: LA.latitude } });
    expect((await after()).lon).toBeCloseTo(LA.longitude, 6);

    // Clearing the coordinates must clear the geography, or the property
    // would keep appearing on the map at its old location.
    await prisma.property.update({ where: { id: p.id }, data: { latitude: null, longitude: null } });
    expect((await after()).lon).toBeNull();

    await prisma.property.delete({ where: { id: p.id } });
  });

  it("has a GiST index, so radius search is a lookup and not a scan", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'Property' AND indexdef ILIKE '%gist%'`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].indexdef.toLowerCase()).toContain("geo");
  });
});

describe("findPropertiesWithinRadius", () => {
  it("finds a property inside the radius", async () => {
    const result = await findPropertiesWithinRadius(ctxFor(orgA.id), {
      latitude: NYC.latitude, longitude: NYC.longitude, radiusMeters: 50 * METERS_PER_MILE,
    });
    expect(result.properties.map((p) => p.name)).toContain(`A-NYC-${suffix}`);
    expect(result.properties[0].distanceMeters).toBeCloseTo(0, 0);
  });

  it("excludes one outside the radius", async () => {
    const result = await findPropertiesWithinRadius(ctxFor(orgA.id), {
      latitude: NYC.latitude, longitude: NYC.longitude, radiusMeters: 50 * METERS_PER_MILE,
    });
    expect(result.properties.map((p) => p.name)).not.toContain(`A-LA-${suffix}`);
  });

  it("includes it once the radius reaches that far", async () => {
    const result = await findPropertiesWithinRadius(ctxFor(orgA.id), {
      latitude: NYC.latitude, longitude: NYC.longitude, radiusMeters: NYC_TO_LA_METERS * 1.01,
    });
    expect(result.properties.map((p) => p.name)).toContain(`A-LA-${suffix}`);
  });

  it("NEVER returns another organization's property", async () => {
    // The leak this guards against would be invisible to every other test:
    // raw SQL bypasses the Prisma access layer the rest of the app uses.
    const result = await findPropertiesWithinRadius(ctxFor(orgA.id), {
      latitude: NYC.latitude, longitude: NYC.longitude, radiusMeters: NYC_TO_LA_METERS * 2,
    });
    expect(result.properties.map((p) => p.name)).not.toContain(`B-NYC-${suffix}`);
    for (const p of result.properties) expect(p.name.startsWith("A-")).toBe(true);
  });

  it("applies grant-level scope, not just the organization boundary", async () => {
    // A scoped role with only a North grant must not see the LA property,
    // even though both belong to their own organization.
    const scoped = ctxFor(orgA.id, Role.REGIONAL_MANAGER, [
      { scopeType: AccessScopeType.REGION, regionId: regionNorth.id, portfolioId: null, propertyId: null },
    ] as SessionContext["grants"]);

    const result = await findPropertiesWithinRadius(scoped, {
      latitude: NYC.latitude, longitude: NYC.longitude, radiusMeters: NYC_TO_LA_METERS * 2,
    });
    const names = result.properties.map((p) => p.name);
    expect(names).toContain(`A-NYC-${suffix}`);
    expect(names).not.toContain(`A-LA-${suffix}`);
  });

  it("returns nothing for a scoped role with no grants", async () => {
    const ungranted = ctxFor(orgA.id, Role.TECHNICIAN, []);
    const result = await findPropertiesWithinRadius(ungranted, {
      latitude: NYC.latitude, longitude: NYC.longitude, radiusMeters: NYC_TO_LA_METERS * 2,
    });
    expect(result.properties).toHaveLength(0);
  });

  it("skips properties that have no coordinates", async () => {
    const result = await findPropertiesWithinRadius(ctxFor(orgA.id), {
      latitude: NYC.latitude, longitude: NYC.longitude, radiusMeters: NYC_TO_LA_METERS * 2,
    });
    expect(result.properties.map((p) => p.name)).not.toContain(`A-NOCOORDS-${suffix}`);
  });

  it("orders nearest first", async () => {
    const result = await findPropertiesWithinRadius(ctxFor(orgA.id), {
      latitude: NYC.latitude, longitude: NYC.longitude, radiusMeters: NYC_TO_LA_METERS * 2,
    });
    const distances = result.properties.map((p) => p.distanceMeters ?? 0);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it("refuses coordinates that are not on Earth", async () => {
    const ctx = ctxFor(orgA.id);
    await expect(findPropertiesWithinRadius(ctx, { latitude: 91, longitude: 0, radiusMeters: 1000 })).rejects.toThrow(ApiError);
    await expect(findPropertiesWithinRadius(ctx, { latitude: 0, longitude: 181, radiusMeters: 1000 })).rejects.toThrow(ApiError);
    await expect(findPropertiesWithinRadius(ctx, { latitude: NaN, longitude: 0, radiusMeters: 1000 })).rejects.toThrow(ApiError);
  });

  it("refuses a non-positive or absurd radius", async () => {
    const ctx = ctxFor(orgA.id);
    await expect(findPropertiesWithinRadius(ctx, { ...NYC, radiusMeters: 0 })).rejects.toThrow(ApiError);
    await expect(findPropertiesWithinRadius(ctx, { ...NYC, radiusMeters: -5 })).rejects.toThrow(ApiError);
    await expect(findPropertiesWithinRadius(ctx, { ...NYC, radiusMeters: 1e12 })).rejects.toThrow(ApiError);
  });

  it("honours the limit", async () => {
    const result = await findPropertiesWithinRadius(ctxFor(orgA.id), {
      latitude: NYC.latitude, longitude: NYC.longitude,
      radiusMeters: NYC_TO_LA_METERS * 2, limit: 1,
    });
    expect(result.properties).toHaveLength(1);
  });
});

describe("findPropertiesInBounds", () => {
  it("returns properties inside the viewport", async () => {
    const result = await findPropertiesInBounds(ctxFor(orgA.id), {
      north: 41, south: 40, east: -73, west: -75,
    });
    const names = result.properties.map((p) => p.name);
    expect(names).toContain(`A-NYC-${suffix}`);
    expect(names).not.toContain(`A-LA-${suffix}`);
  });

  it("does not leak across organizations", async () => {
    const result = await findPropertiesInBounds(ctxFor(orgA.id), {
      north: 41, south: 40, east: -73, west: -75,
    });
    expect(result.properties.map((p) => p.name)).not.toContain(`B-NYC-${suffix}`);
  });

  it("selects the right side of the antimeridian for a wrapped box", async () => {
    // west > east wraps the Pacific. Asserting only that the US properties
    // are absent would pass for any broken implementation that returned
    // nothing at all, so this pins both sides: the two Pacific properties
    // must be IN and the two others OUT.
    const pf = await prisma.portfolio.findFirstOrThrow({ where: { organizationId: orgA.id } });
    const fiji = await makeProperty(orgA.id, pf.id, `A-FIJI-${suffix}`, { latitude: -17, longitude: 178 });
    const samoa = await makeProperty(orgA.id, pf.id, `A-SAMOA-${suffix}`, { latitude: -13, longitude: -172 });
    const tokyo = await makeProperty(orgA.id, pf.id, `A-TOKYO-${suffix}`, { latitude: 35.68, longitude: 139.69 });

    const result = await findPropertiesInBounds(ctxFor(orgA.id), {
      north: 50, south: -50, east: -170, west: 170,
    });
    const names = result.properties.map((p) => p.name);
    expect(names).toContain(`A-FIJI-${suffix}`);
    expect(names).toContain(`A-SAMOA-${suffix}`);
    expect(names).not.toContain(`A-TOKYO-${suffix}`);
    expect(names).not.toContain(`A-NYC-${suffix}`);
    expect(names).not.toContain(`A-LA-${suffix}`);

    await prisma.property.deleteMany({ where: { id: { in: [fiji.id, samoa.id, tokyo.id] } } });
  });

  it("handles a fully zoomed-out map instead of erroring", async () => {
    // A box spanning >=180 degrees of longitude has an antipodal edge, and
    // PostGIS rejects it outright: "Antipodal (180 degrees long) edge
    // detected!". This surfaced as a 500 on the most ordinary map
    // interaction there is — zooming all the way out.
    const result = await findPropertiesInBounds(ctxFor(orgA.id), {
      north: 90, south: -90, east: 180, west: -179.9,
    });
    const names = result.properties.map((p) => p.name);
    expect(names).toContain(`A-NYC-${suffix}`);
    expect(names).toContain(`A-LA-${suffix}`);
    // Still a real filter, not a bypass: the org boundary and the latitude
    // band both continue to apply.
    expect(names).not.toContain(`B-NYC-${suffix}`);
    expect(names).not.toContain(`A-NOCOORDS-${suffix}`);
  });

  it("keeps filtering latitude when every longitude is in view", async () => {
    // North America only; the band must still exclude southern-hemisphere
    // sites even though the longitude constraint has been dropped.
    const pf = await prisma.portfolio.findFirstOrThrow({ where: { organizationId: orgA.id } });
    const sydney = await makeProperty(orgA.id, pf.id, `A-SYD-${suffix}`, { latitude: -33.87, longitude: 151.21 });

    const result = await findPropertiesInBounds(ctxFor(orgA.id), {
      north: 60, south: 20, east: 180, west: -179.9,
    });
    const names = result.properties.map((p) => p.name);
    expect(names).toContain(`A-NYC-${suffix}`);
    expect(names).not.toContain(`A-SYD-${suffix}`);

    await prisma.property.delete({ where: { id: sydney.id } });
  });

  it("refuses an inverted or off-Earth box", async () => {
    const ctx = ctxFor(orgA.id);
    await expect(findPropertiesInBounds(ctx, { north: 40, south: 41, east: -73, west: -75 })).rejects.toThrow(ApiError);
    await expect(findPropertiesInBounds(ctx, { north: 95, south: 0, east: 0, west: -1 })).rejects.toThrow(ApiError);
  });
});

describe("findNearestProperties", () => {
  it("returns the closest property first", async () => {
    const result = await findNearestProperties(ctxFor(orgA.id), {
      latitude: NYC.latitude, longitude: NYC.longitude, limit: 2,
    });
    expect(result.properties[0].name).toBe(`A-NYC-${suffix}`);
  });

  it("measures distance in metres", async () => {
    const result = await findNearestProperties(ctxFor(orgA.id), {
      latitude: NYC.latitude, longitude: NYC.longitude, limit: 5,
    });
    const la = result.properties.find((p) => p.name === `A-LA-${suffix}`);
    expect(la?.distanceMeters).toBeGreaterThan(NYC_TO_LA_METERS * 0.999);
    expect(la?.distanceMeters).toBeLessThan(NYC_TO_LA_METERS * 1.001);
  });

  it("still returns the nearest VISIBLE property when a closer one is hidden", async () => {
    // The KNN ordering happens before the access scope is applied. Asking
    // the database for exactly `limit` rows would return an empty list here,
    // because the nearest row is one this session may not see.
    const scoped = ctxFor(orgA.id, Role.REGIONAL_MANAGER, [
      { scopeType: AccessScopeType.REGION, regionId: regionSouth.id, portfolioId: null, propertyId: null },
    ] as SessionContext["grants"]);

    const result = await findNearestProperties(scoped, {
      latitude: NYC.latitude, longitude: NYC.longitude, limit: 1,
    });
    // NYC (north region) is nearest but invisible; LA (south region) is not.
    expect(result.properties.map((p) => p.name)).toEqual([`A-LA-${suffix}`]);
  });

  it("does not return another organization's nearest property", async () => {
    const result = await findNearestProperties(ctxFor(orgA.id), {
      latitude: NYC.latitude, longitude: NYC.longitude, limit: 50,
    });
    expect(result.properties.map((p) => p.name)).not.toContain(`B-NYC-${suffix}`);
  });
});

describe("metersToMiles", () => {
  it("uses the statute mile", () => {
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 9);
    expect(metersToMiles(NYC_TO_LA_METERS)).toBeCloseTo(2450.9, 0);
  });
});

/**
 * The SQL-level organizationId filter is not the security boundary — Prisma
 * is, and removing the SQL filter leaks nothing. What it protects is
 * COMPLETENESS: candidates are capped, and without it the cap is spent on
 * other tenants' rows, so a caller on a busy database silently receives
 * fewer of their own properties than match. That only bites above the real
 * cap of 5,000 rows, so these drive it with a small injected cap instead.
 */
describe("the candidate cap and the SQL tenant filter", () => {
  it("does not let another organization's properties crowd out your own", async () => {
    // Org B gets a property STRICTLY CLOSER to the query point than org A's.
    // Both sat at identical coordinates before, so `LIMIT 1` picked one
    // arbitrarily and this test passed or failed by chance. Now, without the
    // SQL-level organizationId filter, B's row deterministically takes the
    // only candidate slot and A's own property vanishes from its own search.
    const pfB = await prisma.portfolio.findFirstOrThrow({ where: { organizationId: orgB.id } });
    const closer = await makeProperty(orgB.id, pfB.id, `B-CLOSER-${suffix}`, {
      latitude: NYC.latitude + 0.0001,
      longitude: NYC.longitude,
    });

    const result = await findPropertiesWithinRadius(
      ctxFor(orgA.id),
      { latitude: NYC.latitude + 0.0001, longitude: NYC.longitude, radiusMeters: 50 * METERS_PER_MILE },
      { maxCandidates: 1 },
    );
    expect(result.properties.map((p) => p.name)).toContain(`A-NYC-${suffix}`);

    await prisma.property.delete({ where: { id: closer.id } });
  });

  it("reports truncation rather than presenting a partial answer as complete", async () => {
    const result = await findPropertiesWithinRadius(
      ctxFor(orgA.id),
      { latitude: NYC.latitude, longitude: NYC.longitude, radiusMeters: NYC_TO_LA_METERS * 2 },
      { maxCandidates: 1 },
    );
    expect(result.truncated).toBe(true);
  });

  it("does not claim truncation when everything fitted", async () => {
    const result = await findPropertiesWithinRadius(ctxFor(orgA.id), {
      latitude: NYC.latitude, longitude: NYC.longitude, radiusMeters: NYC_TO_LA_METERS * 2,
    });
    expect(result.truncated).toBe(false);
  });

  it("applies the same filter to a bounds query", async () => {
    // A bounds query orders by name, so "A-..." always won the single
    // candidate slot against "B-..." and the cap could never bite. Org B's
    // row is named to sort FIRST, so without the SQL organizationId filter
    // it deterministically displaces org A's own property.
    const pfB = await prisma.portfolio.findFirstOrThrow({ where: { organizationId: orgB.id } });
    const first = await makeProperty(orgB.id, pfB.id, `0-B-FIRST-${suffix}`, NYC);

    const result = await findPropertiesInBounds(
      ctxFor(orgA.id),
      { north: 41, south: 40, east: -73, west: -75 },
      { maxCandidates: 1 },
    );
    expect(result.properties.map((p) => p.name)).toContain(`A-NYC-${suffix}`);

    await prisma.property.delete({ where: { id: first.id } });
  });
});

/**
 * ST_DWithin and `ST_Distance(...) < r` return the SAME ROWS, so no
 * behavioural test can tell them apart. The difference is that only
 * ST_DWithin can use the GiST index; substituting the other silently turns
 * every radius search into a full table scan. That is invisible until the
 * table is large, which is why it is asserted against the query plan.
 */
describe("radius search uses the spatial index", () => {
  /**
   * `SET LOCAL` lasts only for the current TRANSACTION. Issued outside one it
   * is reset before the EXPLAIN runs, which made an earlier version of these
   * tests pass alone and fail inside the full suite. Both statements have to
   * share one transaction.
   *
   * The setting is needed at all because with a handful of rows a sequential
   * scan is genuinely cheaper; disabling it is what reveals whether the index
   * is USABLE, which is the property under test.
   */
  async function explain(predicate: Prisma.Sql): Promise<string> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      const plan = await tx.$queryRaw<Array<{ "QUERY PLAN": string }>>(
        Prisma.sql`EXPLAIN SELECT id FROM "Property" WHERE "geo" IS NOT NULL AND ${predicate}`,
      );
      return plan.map((r) => r["QUERY PLAN"]).join("\n");
    });
  }

  /**
   * The distinguishing feature is NOT "Index Scan" and not the index's name.
   * With enable_seqscan off, BOTH predicates produce an Index Scan naming
   * this index — an earlier version of these tests asserted exactly that and
   * would have passed for the non-indexable form.
   *
   * What actually differs is where the spatial work happens:
   *
   *   ST_DWithin       Index Cond: (geo && _st_expand(point, 80000))
   *   ST_Distance < r  Index Cond: (geo IS NOT NULL)
   *                    Filter:     st_distance(...) < 80000
   *
   * Only the first pushes the bounding-box operator into the index. The
   * second walks the whole index and filters every row it returns, which is
   * a full scan wearing an index's name.
   */
  function spatialIndexCond(plan: string): string {
    return plan
      .split("\n")
      .filter((line) => line.includes("Index Cond:"))
      .join(" ");
  }

  it("pushes the service's own radius predicate into the index condition", async () => {
    // Uses radiusPredicate — the exact fragment the service runs — so
    // swapping it for a non-indexable equivalent fails here. A hand-copied
    // query in this file would prove only that PostGIS works.
    const cond = spatialIndexCond(await explain(radiusPredicate(NYC.longitude, NYC.latitude, 80000)));
    expect(cond).toContain("_st_expand");
  });

  it("shows ST_Distance leaving the spatial work as a per-row filter", async () => {
    const point = `SRID=4326;POINT(${NYC.longitude} ${NYC.latitude})`;
    const plan = await explain(Prisma.sql`ST_Distance("geo", ${point}::geography) < 80000`);
    expect(spatialIndexCond(plan)).not.toContain("_st_expand");
    expect(plan).toContain("Filter:");
  });
});
