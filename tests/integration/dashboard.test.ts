import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { AccessScopeType, Role } from "@/generated/prisma/client";
import { getPortfolioDashboard } from "@/lib/dashboard";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * `getPortfolioDashboard` declares itself the one source of truth for every
 * portfolio KPI — the API route, the AI gateway and the reports all read it —
 * and it had no test coverage at all.
 *
 * It filters through the `property` RELATION rather than an `IN (...)` list of
 * ids, because one bind parameter per property put a hard ceiling on the whole
 * dashboard at ~65k properties. A relation filter is a different mechanism
 * from an id list, so these check the numbers AND the scoping, not just that
 * it returns without throwing.
 */

const suffix = `db${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };
let regionNorth: { id: string };
let regionSouth: { id: string };
let northProperty: { id: string };
let southProperty: { id: string };

function ctxFor(
  orgId: string,
  role: Role = Role.OWNER,
  grants: SessionContext["grants"] = [],
): SessionContext {
  return {
    userId: user.id,
    userName: "DB User",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: orgId,
    organizationName: "DB Org",
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

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `DB Org ${suffix}`, slug: `db-org-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `DB Other ${suffix}`, slug: `db-other-${suffix}` } });
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "DB" } });

  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const otherPf = await prisma.portfolio.create({ data: { organizationId: otherOrg.id, name: "OPF" } });
  regionNorth = await prisma.region.create({ data: { portfolioId: pf.id, name: "North" } });
  regionSouth = await prisma.region.create({ data: { portfolioId: pf.id, name: "South" } });

  const makeProperty = (orgId: string, portfolioId: string, name: string, regionId?: string) =>
    prisma.property.create({
      data: {
        organizationId: orgId, portfolioId, regionId: regionId ?? null, name,
        addressLine1: "1 Main St", city: "Testville", state: "TX", postalCode: "75001",
      },
    });

  northProperty = await makeProperty(org.id, pf.id, `north-${suffix}`, regionNorth.id);
  southProperty = await makeProperty(org.id, pf.id, `south-${suffix}`, regionSouth.id);
  const foreign = await makeProperty(otherOrg.id, otherPf.id, `foreign-${suffix}`);

  // North: 2 active assets (1 critical), 2 open issues (1 critical).
  await prisma.asset.createMany({
    data: [
      { organizationId: org.id, propertyId: northProperty.id, name: "N1", assetType: "HVAC", criticalityScore: 5 },
      { organizationId: org.id, propertyId: northProperty.id, name: "N2", assetType: "Roof", criticalityScore: 2 },
      // Inactive: must not be counted.
      { organizationId: org.id, propertyId: northProperty.id, name: "N3", assetType: "Roof", criticalityScore: 5, status: "INACTIVE" },
    ],
  });
  await prisma.issue.createMany({
    data: [
      { organizationId: org.id, propertyId: northProperty.id, title: "N-open", createdById: user.id, status: "OPEN", severity: "CRITICAL" },
      { organizationId: org.id, propertyId: northProperty.id, title: "N-prog", createdById: user.id, status: "IN_PROGRESS", severity: "LOW" },
      // Resolved: must not be counted as open.
      { organizationId: org.id, propertyId: northProperty.id, title: "N-done", createdById: user.id, status: "RESOLVED", severity: "CRITICAL" },
    ],
  });

  // South: 1 active asset, 1 open issue.
  await prisma.asset.create({
    data: { organizationId: org.id, propertyId: southProperty.id, name: "S1", assetType: "HVAC", criticalityScore: 1 },
  });
  await prisma.issue.create({
    data: { organizationId: org.id, propertyId: southProperty.id, title: "S-open", createdById: user.id, status: "OPEN", severity: "HIGH" },
  });

  // The other organization gets a large amount of everything. If any of it
  // reaches the numbers below, scoping has failed.
  await prisma.asset.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({
      organizationId: otherOrg.id, propertyId: foreign.id, name: `F${i}`, assetType: "HVAC", criticalityScore: 5,
    })),
  });
  await prisma.issue.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({
      organizationId: otherOrg.id, propertyId: foreign.id, title: `F${i}`, createdById: user.id, status: "OPEN" as const, severity: "CRITICAL" as const,
    })),
  });
});

afterAll(async () => {
  // Organizations first: issues reference the user through createdById, so
  // deleting the user before its rows are cascaded away violates that key.
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.organization.delete({ where: { id: otherOrg.id } });
  await prisma.user.delete({ where: { id: user.id } });
});

describe("getPortfolioDashboard", () => {
  it("counts an org-wide role's own properties, assets and issues", async () => {
    const d = await getPortfolioDashboard(ctxFor(org.id));
    expect(d.totalProperties).toBe(2);
    expect(d.totalAssets).toBe(3);      // 2 north active + 1 south; the INACTIVE one excluded
    expect(d.criticalAssets).toBe(1);   // only the active criticality-5 one
    expect(d.openIssues).toBe(3);       // 2 north open/in-progress + 1 south; RESOLVED excluded
    expect(d.criticalIssues).toBe(1);   // the resolved critical one excluded
  });

  it("excludes another organization entirely", async () => {
    // The other org holds 50 assets and 50 critical open issues. Any leak
    // shows up as inflated totals here.
    const d = await getPortfolioDashboard(ctxFor(org.id));
    expect(d.totalAssets).toBeLessThan(10);
    expect(d.criticalIssues).toBeLessThan(10);
  });

  it("scopes a region-granted role to that region's numbers", async () => {
    // The mechanism changed from an id list to a relation filter, so the
    // grant path needs asserting directly rather than assumed to carry over.
    const scoped = ctxFor(org.id, Role.REGIONAL_MANAGER, [
      { scopeType: AccessScopeType.REGION, regionId: regionNorth.id, portfolioId: null, propertyId: null },
    ] as SessionContext["grants"]);

    const d = await getPortfolioDashboard(scoped);
    expect(d.totalProperties).toBe(1);
    expect(d.totalAssets).toBe(2);     // north's two active assets only
    expect(d.criticalAssets).toBe(1);
    expect(d.openIssues).toBe(2);      // north's two; south's excluded
  });

  it("returns zeroes for a scoped role with no grants, not everything", async () => {
    // propertyScopeWhere denies by default. A relation filter must inherit
    // that, or an ungranted user would see the whole organization.
    const d = await getPortfolioDashboard(ctxFor(org.id, Role.TECHNICIAN, []));
    expect(d.totalProperties).toBe(0);
    expect(d.totalAssets).toBe(0);
    expect(d.openIssues).toBe(0);
  });

  it("agrees with the same counts computed independently", async () => {
    // Guards against the dashboard and the rest of the app disagreeing —
    // the whole reason this function exists.
    const d = await getPortfolioDashboard(ctxFor(org.id));
    const [properties, assets, issues] = await Promise.all([
      prisma.property.count({ where: { organizationId: org.id } }),
      prisma.asset.count({ where: { organizationId: org.id, status: "ACTIVE" } }),
      prisma.issue.count({
        where: { organizationId: org.id, status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } },
      }),
    ]);
    expect(d.totalProperties).toBe(properties);
    expect(d.totalAssets).toBe(assets);
    expect(d.openIssues).toBe(issues);
  });

  it("counts properties that have never been assessed", async () => {
    const d = await getPortfolioDashboard(ctxFor(org.id));
    expect(d.neverAssessed).toBe(2);
  });
});
