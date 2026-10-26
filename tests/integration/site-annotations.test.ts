import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { createAnnotation, deleteAnnotation, listAnnotations, updateAnnotation } from "@/lib/annotation-service";
import { createEmbed } from "@/lib/embed-service";
import { getSiteMapData } from "@/lib/site-map";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Points and areas of interest, and the site-map layers that match the
 * reference panel: HD images vs project photos vs videos, and every embed
 * kind counted where a person would look for it.
 */

const suffix = `sa${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };
let property: { id: string };
let foreignProperty: { id: string };

function ctxFor(orgId: string, role: Role = Role.OWNER): SessionContext {
  return {
    userId: user.id,
    userName: "SA User",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: orgId,
    organizationName: "SA Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

const square = [
  [-96.798, 32.776],
  [-96.796, 32.776],
  [-96.796, 32.778],
  [-96.798, 32.778],
];

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `SA Org ${suffix}`, slug: `sa-org-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `SA Other ${suffix}`, slug: `sa-other-${suffix}` } });
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "SA" } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const otherPf = await prisma.portfolio.create({ data: { organizationId: otherOrg.id, name: "OPF" } });
  const address = { addressLine1: "1 Main St", city: "Testville", state: "TX", postalCode: "75001", latitude: 32.777, longitude: -96.797 };
  property = await prisma.property.create({ data: { organizationId: org.id, portfolioId: pf.id, name: `site-${suffix}`, ...address } });
  foreignProperty = await prisma.property.create({
    data: { organizationId: otherOrg.id, portfolioId: otherPf.id, name: `foreign-${suffix}`, ...address },
  });

  const geo = { latitude: 32.777, longitude: -96.797 };
  await prisma.evidence.createMany({
    data: [
      { organizationId: org.id, propertyId: property.id, type: "PHOTO", storageKey: "p1.jpg", uploadedById: user.id, ...geo },
      { organizationId: org.id, propertyId: property.id, type: "PHOTO", storageKey: "p2.jpg", uploadedById: user.id },
      { organizationId: org.id, propertyId: property.id, type: "VIDEO", storageKey: "v1.mp4", uploadedById: user.id, ...geo },
      { organizationId: org.id, propertyId: property.id, type: "DRONE_IMAGE", storageKey: "d1.jpg", uploadedById: user.id, ...geo },
      { organizationId: org.id, propertyId: property.id, type: "DOCUMENT", storageKey: "doc.pdf", uploadedById: user.id },
    ],
  });

  const ctx = ctxFor(org.id);
  await createEmbed(ctx, { propertyId: property.id, kind: "VIDEO", name: "Walkthrough", url: "https://youtu.be/dQw4w9WgXcQ" });
  await createEmbed(ctx, { propertyId: property.id, kind: "OTHER", name: "Viewer", url: "https://viewer.example.com/x" });
  await createEmbed(ctx, { propertyId: property.id, kind: "BIM", name: "Model", url: "https://bim.example.com/m" });
  await createEmbed(ctx, { propertyId: property.id, kind: "MATTERPORT", name: "Tour", url: "https://my.matterport.com/show/?m=abc123" });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.organization.delete({ where: { id: otherOrg.id } });
  await prisma.user.delete({ where: { id: user.id } });
});

describe("points and areas of interest", () => {
  it("saves a point and an area, and lists them", async () => {
    const ctx = ctxFor(org.id);
    const point = await createAnnotation(ctx, property.id, { kind: "POINT", title: " Roof hatch ", latitude: 32.7771, longitude: -96.7969 });
    expect(point).toMatchObject({ kind: "POINT", title: "Roof hatch", latitude: 32.7771, longitude: -96.7969, polygon: null });

    const area = await createAnnotation(ctx, property.id, { kind: "AREA", title: "Staging", polygon: [...square, square[0]] });
    expect(area.polygon).toEqual(square);

    const titles = (await listAnnotations(ctx, property.id)).map((a) => a.title);
    expect(titles).toEqual(expect.arrayContaining(["Roof hatch", "Staging"]));
  });

  it("refuses a point without a position and an area without three corners", async () => {
    const ctx = ctxFor(org.id);
    await expect(createAnnotation(ctx, property.id, { kind: "POINT", title: "Nowhere" })).rejects.toThrow(/latitude and longitude/);
    await expect(createAnnotation(ctx, property.id, { kind: "AREA", title: "Line", polygon: square.slice(0, 2) })).rejects.toThrow(/three corners/);
    await expect(createAnnotation(ctx, property.id, { kind: "POINT", title: "  ", latitude: 1, longitude: 1 })).rejects.toThrow(/title/);
  });

  it("lets only property managers change them", async () => {
    await expect(
      createAnnotation(ctxFor(org.id, Role.VIEWER), property.id, { kind: "POINT", title: "x", latitude: 1, longitude: 1 }),
    ).rejects.toThrow(/canManageProperties/);
  });

  it("keeps each organization's marks to itself", async () => {
    const mine = await createAnnotation(ctxFor(org.id), property.id, { kind: "POINT", title: "Mine", latitude: 1, longitude: 1 });
    await expect(listAnnotations(ctxFor(otherOrg.id), property.id)).rejects.toThrow(/not found/i);
    await expect(deleteAnnotation(ctxFor(otherOrg.id), mine.id)).rejects.toThrow(/not found/i);
    await expect(
      createAnnotation(ctxFor(org.id), foreignProperty.id, { kind: "POINT", title: "x", latitude: 1, longitude: 1 }),
    ).rejects.toThrow(/not found/i);
    await deleteAnnotation(ctxFor(org.id), mine.id);
  });

  it("moves, renames and deletes", async () => {
    const ctx = ctxFor(org.id);
    const point = await createAnnotation(ctx, property.id, { kind: "POINT", title: "Gas", latitude: 1, longitude: 1 });
    const moved = await updateAnnotation(ctx, point.id, { title: "Gas shut-off", latitude: 2 });
    expect(moved).toMatchObject({ title: "Gas shut-off", latitude: 2, longitude: 1 });
    await expect(updateAnnotation(ctx, point.id, { latitude: 95 })).rejects.toThrow(/Latitude/);
    await deleteAnnotation(ctx, point.id);
    expect((await listAnnotations(ctx, property.id)).some((a) => a.id === point.id)).toBe(false);
  });
});

describe("site map layers", () => {
  it("splits HD images, project photos and videos", async () => {
    const data = await getSiteMapData(ctxFor(org.id), property.id);
    const layer = (key: string) => data.layers.find((l) => l.key === key)!;
    expect(layer("drone-photos")).toMatchObject({ label: "HD Images", count: 1, mapped: true });
    expect(layer("evidence-photos")).toMatchObject({ label: "Project Photos", count: 2, mapped: true });
    expect(layer("evidence-photos").markers).toHaveLength(1);
    expect(layer("project-videos")).toMatchObject({ label: "Project Videos", count: 1, mapped: true });
  });

  it("counts every embed kind where it belongs", async () => {
    const data = await getSiteMapData(ctxFor(org.id), property.id);
    const count = (key: string) => data.layers.find((l) => l.key === key)!.count;
    expect(count("video-embeds")).toBe(1);
    expect(count("custom-embeds")).toBe(1);
    expect(count("3d-models")).toBe(1);
    expect(count("vr-tours")).toBe(1);
  });

  it("places points of interest and draws areas of interest", async () => {
    const data = await getSiteMapData(ctxFor(org.id), property.id);
    const points = data.layers.find((l) => l.key === "points-of-interest")!;
    const areas = data.layers.find((l) => l.key === "areas-of-interest")!;
    expect(points.markers.map((m) => m.label)).toContain("Roof hatch");
    expect(areas.areas?.map((a) => a.label)).toContain("Staging");
    expect(areas.areas?.find((a) => a.label === "Staging")?.ring).toEqual(square);
    // Each area also has a pin at its centre.
    expect(areas.markers).toHaveLength(areas.areas!.length);
  });
});
