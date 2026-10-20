import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { getStorageProvider } from "@/lib/storage";
import { createOverlay, deleteOverlay, listOverlays, readOverlayContent, updateOverlay } from "@/lib/overlay-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Overlays. What goes wrong without these rules: a plan laid over the map
 * inside out or a continent wide; a broken GeoJSON file that silently draws
 * nothing; another tenant's file served through this organization's map;
 * and anyone who can view a site re-drawing what everyone else reads as its
 * plan.
 */

const suffix = `ov${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let property: { id: string };
let otherProperty: { id: string };
let owner: { id: string };
let manager: { id: string };

function ctx(userId: string, role: Role, extra: Partial<SessionContext> = {}): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Overlay Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
    ...extra,
  };
}
const asOwner = () => ctx(owner.id, Role.OWNER);
const asManager = () =>
  ctx(manager.id, Role.FACILITIES_MANAGER, {
    grants: [{ scopeType: "PROPERTY", propertyId: property.id, portfolioId: null, regionId: null }],
  });

const edges = { north: 39.101, south: 39.099, east: -94.577, west: -94.58 };

async function stored(name: string, bytes: Buffer, organizationId = org.id) {
  const key = `${organizationId}/${crypto.randomUUID()}-${name}`;
  await getStorageProvider().writeBytes(key, bytes);
  return key;
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `OV ${suffix}`, slug: `ov-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
    });
  property = await mk("site");
  otherProperty = await mk("other");
  const user = (label: string) =>
    prisma.user.create({ data: { email: `${label}-${suffix}@example.com`, name: label, passwordHash: "x" } });
  owner = await user("owner");
  manager = await user("manager");
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
});

describe("raster overlays", () => {
  it("stores an aerial with its edges and serves its bytes back", async () => {
    const key = await stored("aerial.png", Buffer.from("png-bytes"));
    const overlay = await createOverlay(asOwner(), {
      propertyId: property.id,
      kind: "RASTER",
      category: "AERIAL",
      name: "Aerial 2026-02-10",
      storageKey: key,
      mimeType: "image/png",
      isDefault: true,
      ...edges,
    });
    expect(overlay).toMatchObject({ ...edges, sizeBytes: 9, isDefault: true });

    const content = await readOverlayContent(asManager(), overlay.id);
    expect(content.mimeType).toBe("image/png");
    expect(content.bytes.toString()).toBe("png-bytes");
  });

  it("refuses swapped edges, a non-image, and moving edges inside out later", async () => {
    const key = await stored("plan.png", Buffer.from("x"));
    const base = { propertyId: property.id, kind: "RASTER" as const, name: "Plan", storageKey: key, mimeType: "image/png" };
    await expect(createOverlay(asOwner(), { ...base, ...edges, north: edges.south, south: edges.north })).rejects.toThrow(/north edge/);
    await expect(createOverlay(asOwner(), { ...base, ...edges, mimeType: "application/pdf" })).rejects.toThrow(/PNG, JPEG or WebP/);

    const ok = await createOverlay(asOwner(), { ...base, ...edges });
    await expect(updateOverlay(asOwner(), ok.id, { north: edges.south - 0.01 })).rejects.toThrow(/north edge/);
    expect((await updateOverlay(asOwner(), ok.id, { north: edges.north + 0.0005 })).north).toBeCloseTo(edges.north + 0.0005);
  });
});

describe("vector overlays", () => {
  it("checks the GeoJSON before accepting it", async () => {
    const good = await stored("zones.geojson", Buffer.from(JSON.stringify({ type: "Point", coordinates: [-94.578, 39.1] })));
    const overlay = await createOverlay(asOwner(), {
      propertyId: property.id,
      kind: "VECTOR",
      name: "Zones",
      storageKey: good,
      mimeType: "application/json",
    });
    expect(overlay.mimeType).toBe("application/geo+json");
    expect(overlay.north).toBeNull();

    const bad = await stored("broken.geojson", Buffer.from("{nope"));
    await expect(
      createOverlay(asOwner(), { propertyId: property.id, kind: "VECTOR", name: "Broken", storageKey: bad, mimeType: "application/json" }),
    ).rejects.toThrow(/not valid JSON/);
  });
});

describe("who and what", () => {
  it("needs canManageProperties to add, change or delete", async () => {
    const key = await stored("a.png", Buffer.from("x"));
    await expect(
      createOverlay(asManager(), { propertyId: property.id, kind: "RASTER", name: "A", storageKey: key, mimeType: "image/png", ...edges }),
    ).rejects.toThrow(/canManageProperties/);
  });

  it("will not register a file from outside this organization's storage", async () => {
    const foreign = await stored("theirs.png", Buffer.from("x"), "some-other-org");
    await expect(
      createOverlay(asOwner(), { propertyId: property.id, kind: "RASTER", name: "Theirs", storageKey: foreign, mimeType: "image/png", ...edges }),
    ).rejects.toThrow(/not uploaded to this organization/);
  });

  it("is invisible outside the viewer's property scope", async () => {
    const key = await stored("b.png", Buffer.from("x"));
    const elsewhere = await createOverlay(asOwner(), {
      propertyId: otherProperty.id,
      kind: "RASTER",
      name: "Elsewhere",
      storageKey: key,
      mimeType: "image/png",
      ...edges,
    });
    await expect(listOverlays(asManager(), otherProperty.id)).rejects.toThrow(/Property not found/);
    await expect(readOverlayContent(asManager(), elsewhere.id)).rejects.toThrow(/Overlay not found/);
  });

  it("deletes the overlay and its file", async () => {
    const key = await stored("c.png", Buffer.from("x"));
    const overlay = await createOverlay(asOwner(), {
      propertyId: property.id,
      kind: "RASTER",
      name: "Temp",
      storageKey: key,
      mimeType: "image/png",
      ...edges,
    });
    await deleteOverlay(asOwner(), overlay.id);
    expect(await prisma.propertyOverlay.findUnique({ where: { id: overlay.id } })).toBeNull();
    expect(await getStorageProvider().readBytes(key)).toBeNull();
  });
});
