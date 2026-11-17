import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { getAssetLocation, parseTourLink, pinAssetToTour, removeTourPin } from "@/lib/asset-location-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Where a piece of equipment is, across the 3D tour, 360 photos and aerial
 * imagery. What goes wrong without these rules: a pin copied from another
 * building's tour sending people to the wrong place; a viewer editing pins;
 * one store's flights or panoramas showing under another's equipment; and a
 * store with none of the three showing a blank where it should say so.
 */

const suffix = `al${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let store: { id: string };
let bare: { id: string };
let owner: { id: string };
let viewer: { id: string };
let walkIn: { id: string };
let bareAsset: { id: string };
const SPACE = `Sp${Date.now().toString(36)}`;

function ctx(userId: string, role: Role): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Location Org",
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
const asOwner = () => ctx(owner.id, Role.OWNER);
const asViewer = () => ctx(viewer.id, Role.VIEWER);
const tour = (sweep: string, space = SPACE) => `https://my.matterport.com/show/?m=${space}&ss=${sweep}&play=1`;

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `AL ${suffix}`, slug: `al-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
    });
  store = await mk("store");
  bare = await mk("bare");
  const user = (label: string) => prisma.user.create({ data: { email: `${label}-${suffix}@example.com`, name: label, passwordHash: "x" } });
  owner = await user("owner");
  viewer = await user("viewer");
  walkIn = await prisma.asset.create({ data: { organizationId: org.id, propertyId: store.id, name: "Walk-in", assetType: "Walk-In Cooler & Freezer" } });
  bareAsset = await prisma.asset.create({ data: { organizationId: org.id, propertyId: bare.id, name: "Fryer", assetType: "Deep Fryer Battery" } });

  const connection = await prisma.matterportConnection.create({ data: { organizationId: org.id, status: "CONNECTED" } });
  const space = await prisma.matterportSpace.create({ data: { connectionId: connection.id, externalSpaceId: SPACE, name: "Store tour" } });
  await prisma.matterportPropertyLink.create({ data: { propertyId: store.id, spaceId: space.id } });

  // Two 360 photos at the store, one of them tagged to the walk-in; one flight, imported from DroneDeploy.
  const pano = (assetId: string | null, captureDate: Date) =>
    prisma.evidence.create({
      data: { organizationId: org.id, propertyId: store.id, assetId, type: "IMAGE_360", storageKey: `${org.id}/${suffix}/p-${Math.random()}.jpg`, mimeType: "image/jpeg", uploadedById: owner.id, captureDate },
    });
  await pano(walkIn.id, new Date("2026-11-01T00:00:00Z"));
  await pano(null, new Date("2026-10-01T00:00:00Z"));
  const flight = await prisma.droneCapture.create({ data: { propertyId: store.id, status: "READY", capturedAt: new Date("2026-11-05T00:00:00Z") } });
  await prisma.droneDeployImport.create({ data: { organizationId: org.id, externalPlanId: `plan-${suffix}`, status: "IMPORTED", propertyId: store.id, captureId: flight.id } });
  await prisma.droneCapture.create({ data: { propertyId: store.id, status: "PROCESSING", capturedAt: new Date("2026-11-10T00:00:00Z") } });
  // A flight at another store must not show here.
  await prisma.droneCapture.create({ data: { propertyId: bare.id, status: "READY", capturedAt: new Date("2026-11-12T00:00:00Z") } });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, viewer.id] } } });
});

describe("parseTourLink", () => {
  it("reads the space and the position from a Matterport link", () => {
    expect(parseTourLink(tour("abc123"))).toEqual({ spaceId: SPACE, sweepId: "abc123" });
  });
  it("refuses what is not a Matterport link, or names no position", () => {
    expect(parseTourLink("https://evil.example/show/?m=A&ss=B")).toBeNull();
    expect(parseTourLink("https://matterport.com.evil.example/show/?m=A&ss=B")).toBeNull();
    expect(parseTourLink("http://my.matterport.com/show/?m=A&ss=B")).toBeNull();
    expect(parseTourLink("https://my.matterport.com/show/?m=A")).toBeNull();
    expect(parseTourLink("https://my.matterport.com/show/?m=A&ss=B/../x")).toBeNull();
    expect(parseTourLink("not a url")).toBeNull();
  });
});

describe("where equipment is", () => {
  it("shows the tour, the 360 photos and the latest ready flight for its own store", async () => {
    const loc = await getAssetLocation(asOwner(), walkIn.id);
    expect(loc.tour).toMatchObject({ linked: true, spaceName: "Store tour" });
    expect(loc.tour.url).toContain(`m=${SPACE}`);
    expect(loc.panoramas.ofThisAsset).toHaveLength(1);
    expect(loc.panoramas.atStore).toBe(2);
    // The ready, DroneDeploy-imported flight, not the one still processing and not the other store's.
    expect(loc.aerial.latest).toMatchObject({ fromDroneDeploy: true });
    expect(loc.aerial.latest?.capturedAt).toEqual(new Date("2026-11-05T00:00:00Z"));
  });

  it("says so when a store has no tour and no 360 photos", async () => {
    const loc = await getAssetLocation(asOwner(), bareAsset.id);
    expect(loc.tour).toMatchObject({ linked: false, pins: [] });
    expect(loc.panoramas).toEqual({ ofThisAsset: [], atStore: 0 });
    expect(loc.aerial.latest?.fromDroneDeploy).toBe(false); // its own flight, not DroneDeploy's
  });
});

describe("pinning equipment to the tour", () => {
  it("saves the position and opens the tour there", async () => {
    await pinAssetToTour(asOwner(), walkIn.id, { url: tour("sweep1"), label: "Back corridor" });
    const loc = await getAssetLocation(asOwner(), walkIn.id);
    expect(loc.tour.pins).toHaveLength(1);
    expect(loc.tour.pins[0]).toMatchObject({ label: "Back corridor", sweepId: "sweep1" });
    expect(loc.tour.pins[0].url).toContain("ss=sweep1");
  });

  it("does not pin the same spot twice", async () => {
    await pinAssetToTour(asOwner(), walkIn.id, { url: tour("sweep1") });
    expect((await getAssetLocation(asOwner(), walkIn.id)).tour.pins).toHaveLength(1);
  });

  it("refuses a link from another building's tour", async () => {
    await expect(pinAssetToTour(asOwner(), walkIn.id, { url: tour("sweepX", "SomeoneElsesTour") })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses to pin where no tour is linked, and a link with no position", async () => {
    await expect(pinAssetToTour(asOwner(), bareAsset.id, { url: tour("sweepY") })).rejects.toMatchObject({ status: 409 });
    await expect(pinAssetToTour(asOwner(), walkIn.id, { url: `https://my.matterport.com/show/?m=${SPACE}` })).rejects.toMatchObject({ status: 400 });
  });

  it("is for managers, and removing a pin works", async () => {
    await expect(pinAssetToTour(asViewer(), walkIn.id, { url: tour("sweepZ") })).rejects.toMatchObject({ status: 403 });
    const [pin] = (await getAssetLocation(asOwner(), walkIn.id)).tour.pins;
    await expect(removeTourPin(asViewer(), walkIn.id, pin.id)).rejects.toMatchObject({ status: 403 });
    await removeTourPin(asOwner(), walkIn.id, pin.id);
    expect((await getAssetLocation(asOwner(), walkIn.id)).tour.pins).toHaveLength(0);
    await expect(removeTourPin(asOwner(), walkIn.id, pin.id)).rejects.toMatchObject({ status: 404 });
  });
});
