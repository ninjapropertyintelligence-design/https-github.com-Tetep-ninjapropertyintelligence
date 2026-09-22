import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { AccessScopeType, Role } from "@/generated/prisma/client";
import { getSiteMapData } from "@/lib/site-map";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * The site map makes two claims a viewer will act on: a count per layer, and
 * whether that layer can be drawn. Both can be wrong in ways that look fine.
 *
 * A layer marked `mapped` whose records have no coordinates gives a toggle
 * that does nothing. A layer marked unmapped that *does* have coordinates
 * silently hides real capture positions. And a count that leaks another
 * organization's rows is a tenancy breach dressed as a number.
 */

const suffix = `sm${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };
let property: { id: string };
let foreignProperty: { id: string };
let region: { id: string };

function ctxFor(orgId: string, role: Role = Role.OWNER, grants: SessionContext["grants"] = []): SessionContext {
  return {
    userId: user.id,
    userName: "SM User",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: orgId,
    organizationName: "SM Org",
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

const layer = (data: Awaited<ReturnType<typeof getSiteMapData>>, key: string) => {
  const found = data.layers.find((l) => l.key === key);
  if (!found) throw new Error(`No layer "${key}" — the layer list changed and this test was not updated`);
  return found;
};

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `SM Org ${suffix}`, slug: `sm-org-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `SM Other ${suffix}`, slug: `sm-other-${suffix}` } });
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "SM" } });

  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const otherPf = await prisma.portfolio.create({ data: { organizationId: otherOrg.id, name: "OPF" } });
  region = await prisma.region.create({ data: { portfolioId: pf.id, name: "Region" } });

  property = await prisma.property.create({
    data: {
      organizationId: org.id, portfolioId: pf.id, regionId: region.id, name: `site-${suffix}`,
      addressLine1: "1 Main St", city: "Testville", state: "TX", postalCode: "75001",
      latitude: 32.7767, longitude: -96.797,
    },
  });
  foreignProperty = await prisma.property.create({
    data: {
      organizationId: otherOrg.id, portfolioId: otherPf.id, name: `foreign-${suffix}`,
      addressLine1: "9 Other St", city: "Elsewhere", state: "CA", postalCode: "90001",
      latitude: 34.05, longitude: -118.24,
    },
  });

  // Drone imagery: three photos, only two geotagged. The third must be
  // counted but must not produce a marker.
  const capture = await prisma.droneCapture.create({
    data: { propertyId: property.id, capturedAt: new Date("2026-03-04T00:00:00Z"), capturedById: user.id, status: "READY" },
  });
  const dataset = await prisma.droneDataset.create({ data: { captureId: capture.id, provider: "MANUAL_UPLOAD" } });
  await prisma.droneImage.createMany({
    data: [
      { datasetId: dataset.id, storageKey: `${org.id}/a-roof.jpg`, latitude: 32.7768, longitude: -96.7971 },
      { datasetId: dataset.id, storageKey: `${org.id}/b-facade.jpg`, latitude: 32.7766, longitude: -96.7969 },
      { datasetId: dataset.id, storageKey: `${org.id}/c-nogeo.jpg` },
    ],
  });
  await prisma.droneOutput.createMany({
    data: [
      { datasetId: dataset.id, outputType: "MESH_3D", storageKey: `${org.id}/mesh.ply` },
      { datasetId: dataset.id, outputType: "POINT_CLOUD", storageKey: `${org.id}/cloud.xyz` },
      { datasetId: dataset.id, outputType: "ORTHOMOSAIC", storageKey: `${org.id}/ortho.tif` },
    ],
  });

  // An older capture: the reported "last capture" must be the newest.
  await prisma.droneCapture.create({
    data: { propertyId: property.id, capturedAt: new Date("2025-01-01T00:00:00Z"), capturedById: user.id, status: "READY" },
  });

  await prisma.asset.createMany({
    data: [
      { organizationId: org.id, propertyId: property.id, name: "A1", assetType: "HVAC", criticalityScore: 3 },
      { organizationId: org.id, propertyId: property.id, name: "A2", assetType: "Roof", criticalityScore: 1 },
    ],
  });
  await prisma.issue.createMany({
    data: [
      { organizationId: org.id, propertyId: property.id, title: "open", createdById: user.id, status: "OPEN", severity: "HIGH" },
      { organizationId: org.id, propertyId: property.id, title: "prog", createdById: user.id, status: "IN_PROGRESS", severity: "LOW" },
      { organizationId: org.id, propertyId: property.id, title: "done", createdById: user.id, status: "RESOLVED", severity: "CRITICAL" },
      { organizationId: org.id, propertyId: property.id, title: "shut", createdById: user.id, status: "CLOSED", severity: "CRITICAL" },
    ],
  });

  // The other organization gets a pile of everything on its own property.
  const foreignCapture = await prisma.droneCapture.create({
    data: { propertyId: foreignProperty.id, capturedAt: new Date(), capturedById: user.id, status: "READY" },
  });
  const foreignDataset = await prisma.droneDataset.create({ data: { captureId: foreignCapture.id, provider: "MANUAL_UPLOAD" } });
  await prisma.droneImage.createMany({
    data: Array.from({ length: 30 }, (_, i) => ({
      datasetId: foreignDataset.id, storageKey: `${otherOrg.id}/f${i}.jpg`, latitude: 34.05, longitude: -118.24,
    })),
  });
  await prisma.asset.createMany({
    data: Array.from({ length: 30 }, (_, i) => ({
      organizationId: otherOrg.id, propertyId: foreignProperty.id, name: `F${i}`, assetType: "HVAC", criticalityScore: 5,
    })),
  });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.organization.delete({ where: { id: otherOrg.id } });
  await prisma.user.delete({ where: { id: user.id } });
});

describe("getSiteMapData", () => {
  it("counts every drone photo but only places the geotagged ones", async () => {
    const data = await getSiteMapData(ctxFor(org.id), property.id);
    const photos = layer(data, "drone-photos");
    expect(photos.count).toBe(3);
    expect(photos.markers).toHaveLength(2);
    expect(photos.mapped).toBe(true);
  });

  it("every marker it does place carries real coordinates", async () => {
    const data = await getSiteMapData(ctxFor(org.id), property.id);
    for (const l of data.layers) {
      for (const m of l.markers) {
        expect(Number.isFinite(m.latitude)).toBe(true);
        expect(Number.isFinite(m.longitude)).toBe(true);
      }
    }
  });

  it("reports mapped:false for a layer with records but no coordinates", async () => {
    const data = await getSiteMapData(ctxFor(org.id), property.id);
    const models = layer(data, "3d-models");
    expect(models.count).toBe(1);
    // The records exist; the schema has nowhere to put their position.
    expect(models.mapped).toBe(false);
    expect(models.markers).toEqual([]);
  });

  it("never reports mapped:true for a layer that produced no markers", async () => {
    const data = await getSiteMapData(ctxFor(org.id), property.id);
    for (const l of data.layers) {
      if (l.mapped) expect(l.markers.length).toBeGreaterThan(0);
    }
  });

  it("counts only issues that are still open", async () => {
    const data = await getSiteMapData(ctxFor(org.id), property.id);
    // Four issues exist; RESOLVED and CLOSED are not open work.
    expect(layer(data, "issues").count).toBe(2);
  });

  it("excludes records-about-the-site from the media headline", async () => {
    const data = await getSiteMapData(ctxFor(org.id), property.id);
    // 3 photos + 1 mesh + 1 point cloud + 1 orthomosaic. Assets and issues
    // describe the site rather than capturing it, so they must not inflate it.
    expect(data.totalMedia).toBe(6);
    expect(layer(data, "assets").count).toBe(2);
    expect(data.totalMedia).toBeLessThan(
      data.layers.reduce((sum, l) => sum + l.count, 0),
    );
  });

  it("reports the newest capture, not the first one found", async () => {
    const data = await getSiteMapData(ctxFor(org.id), property.id);
    expect(data.lastCaptureAt?.toISOString()).toBe("2026-03-04T00:00:00.000Z");
  });

  it("refuses a property belonging to another organization", async () => {
    await expect(getSiteMapData(ctxFor(org.id), foreignProperty.id)).rejects.toThrow(/not found/i);
  });

  it("does not let another organization's captures into the counts", async () => {
    const data = await getSiteMapData(ctxFor(org.id), property.id);
    // The other org holds 30 photos and 30 assets on its own property.
    expect(layer(data, "drone-photos").count).toBe(3);
    expect(layer(data, "assets").count).toBe(2);
  });

  it("refuses a property outside a region-scoped user's grants", async () => {
    const otherRegion = await prisma.region.create({
      data: { portfolioId: (await prisma.portfolio.findFirstOrThrow({ where: { organizationId: org.id } })).id, name: "Elsewhere" },
    });
    const scoped = ctxFor(org.id, Role.REGIONAL_MANAGER, [
      { scopeType: AccessScopeType.REGION, regionId: otherRegion.id, propertyId: null, portfolioId: null },
    ]);
    await expect(getSiteMapData(scoped, property.id)).rejects.toThrow(/not found/i);
  });

  it("allows a region-scoped user whose grant covers the property", async () => {
    const scoped = ctxFor(org.id, Role.REGIONAL_MANAGER, [
      { scopeType: AccessScopeType.REGION, regionId: region.id, propertyId: null, portfolioId: null },
    ]);
    const data = await getSiteMapData(scoped, property.id);
    expect(data.property.id).toBe(property.id);
    expect(layer(data, "drone-photos").count).toBe(3);
  });
});
