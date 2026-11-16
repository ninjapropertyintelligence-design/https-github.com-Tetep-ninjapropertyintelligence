import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { assertAssetRefs } from "@/lib/asset-refs";

/**
 * An asset's section and service contact come from the client. A section in
 * another store, or a vendor from another organization, must be refused, or
 * one customer's asset could name another's contractor.
 */

const suffix = `ar${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let property: { id: string };
let otherProperty: { id: string };
let area: { id: string };
let otherArea: { id: string };
let vendor: { id: string };
let foreignVendor: { id: string };

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
  vendor = await prisma.vendor.create({ data: { organizationId: org.id, name: "Fryer Co" } });
  foreignVendor = await prisma.vendor.create({ data: { organizationId: otherOrg.id, name: "Elsewhere Co" } });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.organization.delete({ where: { id: otherOrg.id } });
});

describe("assertAssetRefs", () => {
  it("accepts a section in the same store and one of the organization's vendors", async () => {
    await expect(assertAssetRefs(org.id, property.id, { areaId: area.id, serviceVendorId: vendor.id })).resolves.toBeUndefined();
    await expect(assertAssetRefs(org.id, property.id, {})).resolves.toBeUndefined();
  });

  it("refuses a section from another store", async () => {
    await expect(assertAssetRefs(org.id, property.id, { areaId: otherArea.id })).rejects.toThrow(/area is not in this property/);
    expect(otherProperty.id).not.toBe(property.id);
  });

  it("refuses another organization's vendor", async () => {
    await expect(assertAssetRefs(org.id, property.id, { serviceVendorId: foreignVendor.id })).rejects.toThrow(/not one of your vendors/);
  });

  it("stores the service contact and last inspection date, and clears the contact if the vendor goes", async () => {
    const asset = await prisma.asset.create({
      data: {
        organizationId: org.id,
        propertyId: property.id,
        areaId: area.id,
        name: "Fryer 2",
        assetType: "Fryer",
        serviceVendorId: vendor.id,
        lastInspectedAt: new Date("2026-10-01"),
      },
    });
    expect(asset.serviceVendorId).toBe(vendor.id);
    await prisma.vendor.delete({ where: { id: vendor.id } });
    const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.serviceVendorId).toBeNull();
    expect(after.lastInspectedAt?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});
