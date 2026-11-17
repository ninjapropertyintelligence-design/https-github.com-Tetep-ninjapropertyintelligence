import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { createCaptureJob, issueCaptureJob, resolveDroneTargetForSite } from "@/lib/capture-job-service";
import { readGeoTiffCorners, refreshOutputTiling, requestOutputTiling } from "@/lib/drone-map-service";
import { droneMapLayersFor } from "@/lib/drone-map-layers";
import { __setStorageProviderForTest, type StorageProvider } from "@/lib/storage";
import { distanceMeters, lngLatToUtm } from "@/lib/geo/georeference";
import type { SessionContext } from "@/lib/tenant-scope";
import { asPlatform } from "../helpers/platform";
import { rgbGeoTiff } from "../helpers/geotiff";

/**
 * Deep zoom for drone maps: the full-resolution GeoTIFF is streamed to
 * Mapbox to be tiled, its location is read from the file's header, and the
 * tileset is shown only to people who may see the map.
 */

const suffix = `dm${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Store #1052's neighbourhood, Kansas City: UTM zone 15 north.
const ORIGIN = lngLatToUtm(-94.5786, 39.0997, 15);
const TIFF = rgbGeoTiff(64, 32, { zone: 15, easting: ORIGIN.easting, northing: ORIGIN.northing, pixelMeters: 0.5 });

let org: { id: string };
let staff: { id: string };
let vendorUser: { id: string };
let vendor: { id: string };
let site: { id: string };
const staged: string[] = [];
let uploadComplete = false;

function staffCtx(): SessionContext {
  return {
    userId: staff.id,
    userName: "S",
    userEmail: "s@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "DM",
    membershipId: "m",
    role: Role.OWNER,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}
const vendorCtx = (): SessionContext => ({ ...staffCtx(), userId: vendorUser.id, role: Role.VENDOR, vendorId: vendor.id });
const viewerCtx = (): SessionContext => ({ ...staffCtx(), role: Role.VIEWER });

/** Serves the GeoTIFF with byte ranges, the way an object store does. */
function serveTiff(init?: RequestInit) {
  const range = new Headers(init?.headers).get("range");
  if (!range) return new Response(new Uint8Array(TIFF), { status: 200, headers: { "content-length": String(TIFF.length) } });
  const [start, end] = range.replace("bytes=", "").split("-").map(Number);
  const slice = TIFF.subarray(start, Math.min(end + 1, TIFF.length));
  return new Response(new Uint8Array(slice), {
    status: 206,
    headers: { "content-range": `bytes ${start}-${start + slice.length - 1}/${TIFF.length}`, "content-length": String(slice.length) },
  });
}

beforeAll(async () => {
  process.env.MAPBOX_UPLOAD_TOKEN = "sk.test";
  process.env.MAPBOX_USERNAME = "ninja";
  __setStorageProviderForTest({
    getDownloadUrl: async (key: string) => `https://store.example/${key}`,
  } as unknown as StorageProvider);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://store.example/")) return serveTiff(init);
    if (url.includes("api.mapbox.com/uploads/v1/ninja/credentials")) {
      return Response.json({
        accessKeyId: "AKIA",
        secretAccessKey: "secret",
        sessionToken: "session",
        bucket: "tilestream-tilesets-production",
        key: `staging/${suffix}`,
        url: `https://tilestream-tilesets-production.s3.amazonaws.com/staging/${suffix}`,
      });
    }
    if (url.startsWith("https://tilestream-tilesets-production.s3.amazonaws.com/")) {
      staged.push(url);
      // Drain the streamed body, as S3 would.
      await new Response(init?.body as BodyInit).arrayBuffer();
      return new Response(null, { status: 200 });
    }
    if (url.includes("api.mapbox.com/uploads/v1/ninja?") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      expect(body.tileset).toMatch(/^ninja\.pi-[0-9a-f]{24}$/);
      return Response.json({ id: "upload-1" });
    }
    if (url.includes("api.mapbox.com/uploads/v1/ninja/upload-1")) {
      return Response.json({ complete: uploadComplete, error: null, progress: uploadComplete ? 1 : 0.4 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  org = await prisma.organization.create({ data: { name: `DM ${suffix}`, slug: `dm-${suffix}` } });
  vendor = await prisma.vendor.create({ data: { organizationId: org.id, name: `Sky ${suffix}` } });
  staff = await prisma.user.create({ data: { email: `s-${suffix}@example.com`, passwordHash: "x", name: "S" } });
  vendorUser = await prisma.user.create({ data: { email: `v-${suffix}@example.com`, passwordHash: "x", name: "V" } });
  await prisma.membership.create({ data: { userId: staff.id, organizationId: org.id, role: Role.OWNER } });
  await prisma.membership.create({ data: { userId: vendorUser.id, organizationId: org.id, role: Role.VENDOR, vendorId: vendor.id } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  site = await prisma.property.create({
    data: { organizationId: org.id, portfolioId: pf.id, name: `Store ${suffix}`, addressLine1: "1 Main", city: "KC", state: "MO", postalCode: "64101", latitude: 39.0997, longitude: -94.5786 },
  });
  await prisma.featureFlag.upsert({
    where: { key: FEATURE_FLAGS.DRONE_PROCESSING },
    create: { key: FEATURE_FLAGS.DRONE_PROCESSING, description: "drone (test)", defaultEnabled: true },
    update: {},
  });
  await prisma.featureFlagOverride.upsert({
    where: { flagKey_organizationId: { flagKey: FEATURE_FLAGS.DRONE_PROCESSING, organizationId: org.id } },
    create: { flagKey: FEATURE_FLAGS.DRONE_PROCESSING, organizationId: org.id, enabled: true },
    update: { enabled: true },
  });
});

afterEach(() => {
  uploadComplete = false;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  __setStorageProviderForTest(null);
  delete process.env.MAPBOX_UPLOAD_TOKEN;
  delete process.env.MAPBOX_USERNAME;
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: { in: [staff.id, vendorUser.id] } } });
});

async function deliveredMap() {
  const job = await createCaptureJob(asPlatform(staffCtx()), {
    title: `DM ${suffix}`,
    vendorId: vendor.id,
    propertyIds: [site.id],
    deliverables: ["DRONE"],
  });
  await issueCaptureJob(asPlatform(staffCtx()), job.id);
  const { datasetId } = await resolveDroneTargetForSite(vendorCtx(), job.id, job.sites[0].id);
  return prisma.droneOutput.create({
    data: {
      datasetId,
      outputType: "ORTHOMOSAIC",
      storageKey: `${org.id}/0b4f6e7a-1c2d-4e5f-8a9b-0c1d2e3f4a5b-map.tif`,
      sizeBytes: TIFF.length,
    },
  });
}

describe("where a drone map is", () => {
  it("is read from the GeoTIFF header with range requests", async () => {
    const corners = await readGeoTiffCorners("https://store.example/any.tif");
    expect(corners).not.toBeNull();
    // Top-left corner is the tie point; the map is 32 m wide and 16 m tall.
    expect(distanceMeters(corners![0], [-94.5786, 39.0997])).toBeLessThan(0.5);
    expect(distanceMeters(corners![0], corners![1])).toBeCloseTo(32, 0);
    expect(distanceMeters(corners![1], corners![2])).toBeCloseTo(16, 0);
  });
});

describe("deep zoom", () => {
  it("streams the full map to Mapbox, records where it is, and follows it to ready", async () => {
    const output = await deliveredMap();
    const started = await requestOutputTiling(vendorCtx(), output.id);
    expect(started.status).toBe("PROCESSING");
    expect(staged).toHaveLength(1);
    expect(staged[0]).toContain("X-Amz-Security-Token=session");

    // Asking again does not send it twice.
    await requestOutputTiling(vendorCtx(), output.id);
    expect(staged).toHaveLength(1);

    expect((await refreshOutputTiling(vendorCtx(), output.id))!.status).toBe("PROCESSING");
    uploadComplete = true;
    expect((await refreshOutputTiling(vendorCtx(), output.id))!.status).toBe("READY");

    const stored = await prisma.droneOutput.findUniqueOrThrow({ where: { id: output.id } });
    const capture = await prisma.droneCapture.findFirstOrThrow({ where: { datasets: { some: { id: output.datasetId } } } });
    const [layer] = droneMapLayersFor([{ id: capture.id, capturedAt: capture.capturedAt, createdAt: capture.createdAt, outputs: [stored] }]);
    expect(layer.fullMap?.tiling?.status).toBe("READY");
    expect(layer.fullMap?.tiling?.tileset).toBe(started.tileset);
    expect(layer.fullMap?.corners).toHaveLength(4);
  });

  it("is hidden from the customer until approved, and never started by a read-only viewer", async () => {
    const output = await deliveredMap();
    await expect(refreshOutputTiling(viewerCtx(), output.id)).rejects.toMatchObject({ status: 404 });
    await expect(requestOutputTiling(viewerCtx(), output.id)).rejects.toMatchObject({ status: 403 });
  });

  it("says what is missing when Mapbox tiling is not set up", async () => {
    const output = await deliveredMap();
    const saved = process.env.MAPBOX_UPLOAD_TOKEN;
    delete process.env.MAPBOX_UPLOAD_TOKEN;
    try {
      await expect(requestOutputTiling(vendorCtx(), output.id)).rejects.toThrow(/MAPBOX_UPLOAD_TOKEN/);
    } finally {
      process.env.MAPBOX_UPLOAD_TOKEN = saved;
    }
  });
});
