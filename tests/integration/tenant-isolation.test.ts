import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { SessionContext, propertyScopeWhere } from "@/lib/tenant-scope";

/**
 * Cross-tenant isolation tests (spec §49): "Org A user requests Org B
 * property -> EXPECTED: 403." We test at the authorization-logic layer
 * (`propertyScopeWhere`, exercised against a real Postgres test database)
 * rather than over HTTP, since every API route builds its query through
 * this exact function — if it's airtight here, every route inherits that.
 *
 * One deliberate deviation from the spec's literal "403": routes resolve a
 * cross-tenant lookup to 404, not 403, matching `propertyScopeWhere`
 * returning zero rows rather than an access-denied signal. This avoids
 * confirming to a caller that a resource "exists but you can't see it" —
 * an org that doesn't know a competitor's specific customerPropertyId
 * shouldn't be able to fish for its existence via response codes. What
 * matters for the security property under test is proven here: the query
 * returns nothing, full stop.
 */
describe("cross-tenant property isolation", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let portfolioA: { id: string };
  let portfolioB: { id: string };
  let regionA1: { id: string };
  let regionA2: { id: string };
  let propertyA1: { id: string };
  let propertyA2: { id: string };
  let propertyB: { id: string };
  let userA: { id: string };
  const suffix = `t${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    orgA = await prisma.organization.create({ data: { name: `Org A ${suffix}`, slug: `org-a-${suffix}` } });
    orgB = await prisma.organization.create({ data: { name: `Org B ${suffix}`, slug: `org-b-${suffix}` } });

    portfolioA = await prisma.portfolio.create({ data: { organizationId: orgA.id, name: "Portfolio A" } });
    portfolioB = await prisma.portfolio.create({ data: { organizationId: orgB.id, name: "Portfolio B" } });

    regionA1 = await prisma.region.create({ data: { portfolioId: portfolioA.id, name: "Midwest" } });
    regionA2 = await prisma.region.create({ data: { portfolioId: portfolioA.id, name: "Texas" } });

    const baseProperty = {
      organizationId: orgA.id,
      portfolioId: portfolioA.id,
      addressLine1: "1 Main St",
      city: "Chicago",
      state: "IL",
      postalCode: "60601",
    };
    propertyA1 = await prisma.property.create({ data: { ...baseProperty, name: "Store A1", regionId: regionA1.id } });
    propertyA2 = await prisma.property.create({ data: { ...baseProperty, name: "Store A2", regionId: regionA2.id } });
    propertyB = await prisma.property.create({
      data: {
        organizationId: orgB.id,
        portfolioId: portfolioB.id,
        name: "Store B1",
        addressLine1: "2 Elm St",
        city: "Dallas",
        state: "TX",
        postalCode: "75201",
      },
    });

    userA = await prisma.user.create({
      data: { email: `usera-${suffix}@example.com`, passwordHash: "x", name: "User A" },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userA.id } });
    await prisma.organization.delete({ where: { id: orgA.id } }); // cascades portfolios/regions/properties/memberships
    await prisma.organization.delete({ where: { id: orgB.id } });
  });

  function ctxFor(role: Role, grants: SessionContext["grants"] = []): SessionContext {
    return {
      userId: userA.id,
      userName: "User A",
      userEmail: `usera-${suffix}@example.com`,
      isPlatformAdmin: false,
      organizationId: orgA.id,
      organizationName: "Org A",
      membershipId: "irrelevant-for-this-test",
      role,
      vendorId: null,
      grants,
      permissions: [],
    };
  }

  it("OWNER (org-wide) can see both properties in their own org", async () => {
    const ctx = ctxFor(Role.OWNER);
    const results = await prisma.property.findMany({ where: propertyScopeWhere(ctx) });
    const ids = results.map((p) => p.id).sort();
    expect(ids).toEqual([propertyA1.id, propertyA2.id].sort());
  });

  it("OWNER of Org A cannot see Org B's property at all — not found, not just forbidden", async () => {
    const ctx = ctxFor(Role.OWNER);
    const found = await prisma.property.findFirst({
      where: { AND: [{ id: propertyB.id }, propertyScopeWhere(ctx)] },
    });
    expect(found).toBeNull();
  });

  it("REGIONAL_MANAGER with a grant on Midwest only cannot see the Texas property", async () => {
    const ctx = ctxFor(Role.REGIONAL_MANAGER, [
      { scopeType: "REGION", portfolioId: null, regionId: regionA1.id, propertyId: null },
    ]);
    const results = await prisma.property.findMany({ where: propertyScopeWhere(ctx) });
    expect(results.map((p) => p.id)).toEqual([propertyA1.id]);

    const texasLookup = await prisma.property.findFirst({
      where: { AND: [{ id: propertyA2.id }, propertyScopeWhere(ctx)] },
    });
    expect(texasLookup).toBeNull();
  });

  it("a scoped role with zero AccessGrants sees nothing (secure by default), not everything", async () => {
    const ctx = ctxFor(Role.FACILITIES_MANAGER, []);
    const results = await prisma.property.findMany({ where: propertyScopeWhere(ctx) });
    expect(results).toEqual([]);
  });

  it("REGIONAL_MANAGER scoped to Org A can never reach Org B's property, regardless of grants", async () => {
    const ctx = ctxFor(Role.REGIONAL_MANAGER, [
      { scopeType: "PROPERTY", portfolioId: null, regionId: null, propertyId: propertyB.id },
    ]);
    // Even though the (forged/misconfigured) grant names Org B's property ID,
    // the base organizationId filter in propertyScopeWhere still excludes it.
    const found = await prisma.property.findFirst({
      where: { AND: [{ id: propertyB.id }, propertyScopeWhere(ctx)] },
    });
    expect(found).toBeNull();
  });
});
