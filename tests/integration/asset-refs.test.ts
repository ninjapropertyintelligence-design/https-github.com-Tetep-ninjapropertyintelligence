import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { assertAssetRefs } from "@/lib/asset-refs";

/**
 * An asset's building, floor and section come from the client. One from
 * another store must be refused, or an asset could be filed under a store it
 * is not in.
 */

const suffix = `ar${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let property: { id: string };
let otherProperty: { id: string };
let area: { id: string };
let otherArea: { id: string };

async function propertyWithArea(organizationId: string, name: string) {
  const pf = await prisma.portfolio.create({ data: { organizationId, name: `PF ${name}` } });
  const p = await prisma.property.create({
    data: { organizationId, portfolioId: pf.id, name, addressLine1: "1 Main", city: "X", state: "KS", postalCode: "66219" },
  });
  const b = await prisma.building.create({ data: { propertyId: p.id, name: "Main" } });
  const f = await prisma.floor.create({ data: { buildingId: b.id, name: "Ground", level: 0 } });
  const a = await prisma.area.create({ data: { floorId: f.id, name: "Kitchen" } });
  return { p, a };
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `AR ${suffix}`, slug: `ar-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `AR2 ${suffix}`, slug: `ar2-${suffix}` } });
  const mine = await propertyWithArea(org.id, `store-${suffix}`);
  const second = await propertyWithArea(org.id, `store2-${suffix}`);
  property = mine.p;
  area = mine.a;
  otherProperty = second.p;
  otherArea = second.a;
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.organization.delete({ where: { id: otherOrg.id } });
});

describe("assertAssetRefs", () => {
  it("accepts a section in the same store, and no references at all", async () => {
    await expect(assertAssetRefs(property.id, { areaId: area.id })).resolves.toBeUndefined();
    await expect(assertAssetRefs(property.id, {})).resolves.toBeUndefined();
  });

  it("refuses a section from another store", async () => {
    expect(otherProperty.id).not.toBe(property.id);
    await expect(assertAssetRefs(property.id, { areaId: otherArea.id })).rejects.toThrow(/area is not in this property/);
  });

  it("refuses a section from another organization's store", async () => {
    const foreign = await propertyWithArea(otherOrg.id, `foreign-${suffix}`);
    await expect(assertAssetRefs(property.id, { areaId: foreign.a.id })).rejects.toThrow(/area is not in this property/);
  });
});
