import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordAssetConditionChange } from "@/lib/asset-condition";
import { getLatestHealthSnapshot, recalculatePropertyHealth } from "@/lib/scoring";

/**
 * End-to-end check of the spec §12 flow: an asset condition change must
 * append AssetConditionHistory (never overwrite), recompute Asset health,
 * and recompute the Property's health snapshot — all from one call, all
 * against a real database.
 */
describe("asset condition change -> property health pipeline", () => {
  let org: { id: string };
  let user: { id: string };
  let property: { id: string };
  let roofSystem: { id: string };
  let asset: { id: string };
  const suffix = `t${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: `Scoring Org ${suffix}`, slug: `scoring-${suffix}` } });
    const portfolio = await prisma.portfolio.create({ data: { organizationId: org.id, name: "P" } });
    property = await prisma.property.create({
      data: {
        organizationId: org.id,
        portfolioId: portfolio.id,
        name: "Scoring Test Property",
        addressLine1: "1 Test Way",
        city: "Testville",
        state: "TX",
        postalCode: "75001",
      },
    });
    user = await prisma.user.create({
      data: { email: `scoring-${suffix}@example.com`, passwordHash: "x", name: "Scoring Tester" },
    });
    roofSystem = await prisma.buildingSystem.create({ data: { name: "Roof System", category: "Roof" } });
    asset = await prisma.asset.create({
      data: {
        organizationId: org.id,
        propertyId: property.id,
        systemId: roofSystem.id,
        name: "Main Roof",
        assetType: "Membrane Roof",
        criticalityScore: 4,
        replacementCost: 8_000_000, // $80,000
        conditionScore: 80,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.buildingSystem.delete({ where: { id: roofSystem.id } });
  });

  it("has no condition history before any change", async () => {
    const history = await prisma.assetConditionHistory.findMany({ where: { assetId: asset.id } });
    expect(history).toHaveLength(0);
  });

  it("appends history and recomputes asset + property health on a condition change", async () => {
    await recalculatePropertyHealth(property.id); // baseline snapshot at condition=80

    const before = await getLatestHealthSnapshot(property.id);
    expect(before).not.toBeNull();

    const updated = await recordAssetConditionChange({
      assetId: asset.id,
      newScore: 25, // drop into Critical
      changedByUserId: user.id,
      reason: "Storm damage observed during walkthrough",
    });

    expect(updated.conditionScore).toBe(25);
    expect(updated.healthScore).toBeLessThan(80);

    const history = await prisma.assetConditionHistory.findMany({
      where: { assetId: asset.id },
      orderBy: { changedAt: "asc" },
    });
    expect(history).toHaveLength(1);
    expect(history[0].previousScore).toBe(80);
    expect(history[0].newScore).toBe(25);
    expect(history[0].changedByUserId).toBe(user.id);

    const after = await getLatestHealthSnapshot(property.id);
    expect(after).not.toBeNull();
    expect(after!.healthScore).toBeLessThan(before!.healthScore);
    // A high-criticality asset (4) that's now in poor condition should also
    // register capital exposure in the near-term bucket.
    expect(after!.capitalExposure12mo).toBeGreaterThan(0);
  });

  it("condition history is append-only — a second change adds a row, doesn't overwrite", async () => {
    await recordAssetConditionChange({
      assetId: asset.id,
      newScore: 60,
      changedByUserId: user.id,
      reason: "Repaired",
    });
    const history = await prisma.assetConditionHistory.findMany({ where: { assetId: asset.id } });
    expect(history).toHaveLength(2);
  });
});
