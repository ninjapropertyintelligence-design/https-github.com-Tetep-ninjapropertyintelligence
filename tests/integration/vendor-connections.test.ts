import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import {
  addSiteAsset,
  createCaptureJob,
  issueCaptureJob,
  outstandingDeliverables,
  resolveDroneTargetForSite,
  reviewCaptureSite,
  submitCaptureSite,
} from "@/lib/capture-job-service";
import { createDroneCapture, registerDroneOutput } from "@/lib/drone-service";
import {
  connectVendorDroneDeploy,
  connectVendorMatterport,
  disconnectVendorConnection,
  importVendorDroneDeployMap,
  linkVendorMatterportSpace,
  listVendorConnections,
  listVendorDroneDeployMaps,
  refreshVendorDroneDeployImports,
} from "@/lib/vendor-connection-service";
import { runDroneDeployImportForOrganization } from "@/lib/dronedeploy-import-service";
import { captureReviewWhere, type SessionContext } from "@/lib/tenant-scope";
import { __setStorageProviderForTest, getStorageProvider, newObjectKey } from "@/lib/storage";
import { asPlatform } from "../helpers/platform";

/**
 * A vendor's own DroneDeploy and Matterport accounts: connected with keys
 * that are checked and stored encrypted, then used to bring a flight or a
 * scan onto a job site — held for the platform team's approval, on the
 * vendor's key and never the customer's.
 */

const suffix = `vc${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const GOOD_DD_KEY = `dd-key-${suffix}`;
const FILE_BYTES = Buffer.from("fake-orthomosaic-".repeat(100));
let org: { id: string };
let vendor: { id: string };
let otherVendor: { id: string };
let staff: { id: string };
let vendorUser: { id: string };
let site: { id: string };
let farSite: { id: string };

const exportStatus = new Map<string, string>();
let nextExport = 1;

function installFakes() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://files.example.com/")) {
      return new Response(FILE_BYTES, {
        status: 200,
        headers: { "content-length": String(FILE_BYTES.length), "content-disposition": 'attachment; filename="ortho.tif"' },
      });
    }
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const { query, variables } = JSON.parse(String(init?.body ?? "{}"));
    const ok = (data: unknown) => Response.json({ data });
    if (url.includes("dronedeploy.com/graphql")) {
      if (auth !== `Bearer ${GOOD_DD_KEY}`) return new Response("nope", { status: 401 });
      if (query.includes("query Viewer")) return ok({ viewer: { username: "pilot@vendor.example" } });
      if (query.includes("query Plans")) {
        return ok({
          viewer: {
            organization: {
              plans: {
                pageInfo: { hasNextPage: false, endCursor: null },
                edges: [
                  { node: { id: `MapPlan:far-${suffix}`, name: "Somewhere else", dateCreation: new Date().toISOString(), location: { lat: 40, lng: -100 } } },
                  { node: { id: `MapPlan:near-${suffix}`, name: "Store roof flight", dateCreation: new Date().toISOString(), location: { lat: 32.7768, lng: -96.797 } } },
                ],
              },
            },
          },
        });
      }
      if (query.includes("mutation CreateExport")) {
        const id = `Export:${suffix}-${nextExport++}`;
        exportStatus.set(id, "PROCESSING");
        return ok({ createExport: { export: { id } } });
      }
      if (query.includes("query GetExport")) {
        const status = exportStatus.get(variables.id);
        return ok({ node: status ? { status, downloadPath: status === "COMPLETE" ? `https://files.example.com/${variables.id}.tif` : null } : null });
      }
    }
    if (url.includes("matterport.com")) {
      const good = "Basic " + Buffer.from("tok-id:tok-secret").toString("base64");
      if (auth !== good) return new Response("unauthorized", { status: 401 });
      return ok({ models: { totalResults: 1, nextOffset: null, results: [{ id: "SpaceAbc123", name: "Store interior" }] } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

function staffCtx(): SessionContext {
  return {
    userId: staff.id,
    userName: "Staff",
    userEmail: "s@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "VC",
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
const vendorCtx = (vendorId = vendor.id): SessionContext => ({ ...staffCtx(), userId: vendorUser.id, role: Role.VENDOR, vendorId });
const viewerCtx = (): SessionContext => ({ ...staffCtx(), role: Role.VIEWER });

async function issuedJob(deliverables: Array<"DRONE" | "MATTERPORT" | "CONDITION_SCORES">) {
  const job = await createCaptureJob(asPlatform(staffCtx()), {
    title: `VC ${suffix}`,
    vendorId: vendor.id,
    propertyIds: [site.id],
    deliverables,
  });
  await issueCaptureJob(asPlatform(staffCtx()), job.id);
  return job;
}

beforeAll(async () => {
  process.env.MATTERPORT_SDK_KEY ||= "test-sdk-key";
  __setStorageProviderForTest(null);
  org = await prisma.organization.create({ data: { name: `VC ${suffix}`, slug: `vc-${suffix}` } });
  vendor = await prisma.vendor.create({ data: { organizationId: org.id, name: `Sky ${suffix}` } });
  otherVendor = await prisma.vendor.create({ data: { organizationId: org.id, name: `Other ${suffix}` } });
  staff = await prisma.user.create({ data: { email: `s-${suffix}@example.com`, passwordHash: "x", name: "S" } });
  vendorUser = await prisma.user.create({ data: { email: `v-${suffix}@example.com`, passwordHash: "x", name: "V" } });
  await prisma.membership.create({ data: { userId: staff.id, organizationId: org.id, role: Role.OWNER } });
  await prisma.membership.create({ data: { userId: vendorUser.id, organizationId: org.id, role: Role.VENDOR, vendorId: vendor.id } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const base = { organizationId: org.id, portfolioId: pf.id, addressLine1: "1 Main", city: "Dallas", state: "TX", postalCode: "75201" };
  site = await prisma.property.create({ data: { ...base, name: `Store ${suffix}`, latitude: 32.7767, longitude: -96.797 } });
  farSite = await prisma.property.create({ data: { ...base, name: `Far ${suffix}`, latitude: 33.5, longitude: -97.5 } });
  for (const key of [FEATURE_FLAGS.DRONE_PROCESSING, FEATURE_FLAGS.MATTERPORT]) {
    await prisma.featureFlag.upsert({ where: { key }, create: { key, description: `${key} (test)`, defaultEnabled: true }, update: {} });
    await prisma.featureFlagOverride.upsert({
      where: { flagKey_organizationId: { flagKey: key, organizationId: org.id } },
      create: { flagKey: key, organizationId: org.id, enabled: true },
      update: { enabled: true },
    });
  }
  installFakes();
});

afterEach(async () => {
  await prisma.captureJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.droneDeployImport.deleteMany({ where: { organizationId: org.id } });
  await prisma.droneCapture.deleteMany({ where: { propertyId: { in: [site.id, farSite.id] } } });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: { in: [staff.id, vendorUser.id] } } });
});

describe("connecting a vendor's accounts", () => {
  it("checks the key, stores it encrypted, and never hands it back", async () => {
    await expect(connectVendorDroneDeploy(vendorCtx(), "wrong-key")).rejects.toMatchObject({ status: 400 });
    const items = await connectVendorDroneDeploy(vendorCtx(), GOOD_DD_KEY);
    const dd = items.find((i) => i.provider === "DRONEDEPLOY")!;
    expect(dd).toMatchObject({ connected: true, accountLabel: "pilot@vendor.example" });
    expect(JSON.stringify(items)).not.toContain(GOOD_DD_KEY);
    const row = await prisma.vendorConnection.findUniqueOrThrow({
      where: { vendorId_provider: { vendorId: vendor.id, provider: "DRONEDEPLOY" } },
    });
    expect(row.secretEnc).not.toContain(GOOD_DD_KEY);

    await expect(connectVendorMatterport(vendorCtx(), "tok-id", "bad")).rejects.toMatchObject({ status: 400 });
    await connectVendorMatterport(vendorCtx(), "tok-id", "tok-secret");
    expect((await listVendorConnections(vendorCtx())).every((c) => c.connected)).toBe(true);
  });

  it("is the vendor's alone", async () => {
    await expect(connectVendorDroneDeploy(staffCtx(), GOOD_DD_KEY)).rejects.toMatchObject({ status: 403 });
    await expect(listVendorConnections(asPlatform(staffCtx()))).rejects.toMatchObject({ status: 403 });
  });
});

describe("bringing a DroneDeploy flight onto a job site", () => {
  it("lists the vendor's maps nearest the site first, and imports one held for review", async () => {
    await connectVendorDroneDeploy(vendorCtx(), GOOD_DD_KEY);
    const job = await issuedJob(["DRONE"]);
    const jobSite = job.sites[0];

    const maps = await listVendorDroneDeployMaps(vendorCtx(), job.id, jobSite.id);
    expect(maps[0]).toMatchObject({ id: `MapPlan:near-${suffix}`, imported: false });
    expect(maps[0].distanceMeters).toBeLessThan(50);

    const imports = await importVendorDroneDeployMap(vendorCtx(), job.id, jobSite.id, `MapPlan:near-${suffix}`);
    expect(imports).toHaveLength(1);
    expect(imports[0].status).toBe("IMPORTING");
    // The export was asked for straight away, not at the next scheduled pass.
    expect(imports[0].exports.every((e) => e.status === "REQUESTED")).toBe(true);
    expect(exportStatus.size).toBeGreaterThan(0);

    const capture = await prisma.droneCapture.findFirstOrThrow({ where: { propertyId: site.id } });
    expect(capture.captureJobSiteId).toBe(jobSite.id);
    // Held from the customer until the platform team approves the site.
    expect(await prisma.droneCapture.count({ where: { id: capture.id, ...captureReviewWhere(viewerCtx()) } })).toBe(0);
    expect((await outstandingDeliverables(jobSite.id)).missing).not.toContain("DRONE");

    // The customer's own runner never touches it: it runs on the vendor's key.
    await runDroneDeployImportForOrganization(org.id);

    for (const id of exportStatus.keys()) exportStatus.set(id, "COMPLETE");
    const done = await refreshVendorDroneDeployImports(vendorCtx(), job.id, jobSite.id);
    expect(done[0].status).toBe("IMPORTED");
    expect((await prisma.droneCapture.findUniqueOrThrow({ where: { id: capture.id } })).status).toBe("READY");
  });

  it("refuses a map that is not in the vendor's account, and a job that is not theirs", async () => {
    await connectVendorDroneDeploy(vendorCtx(), GOOD_DD_KEY);
    const job = await issuedJob(["DRONE"]);
    await expect(importVendorDroneDeployMap(vendorCtx(), job.id, job.sites[0].id, "MapPlan:someone-elses")).rejects.toMatchObject({
      status: 404,
    });
    await expect(listVendorDroneDeployMaps(vendorCtx(otherVendor.id), job.id, job.sites[0].id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("says to connect first when there is no account", async () => {
    await disconnectVendorConnection(vendorCtx(), "DRONEDEPLOY");
    const job = await issuedJob(["DRONE"]);
    await expect(listVendorDroneDeployMaps(vendorCtx(), job.id, job.sites[0].id)).rejects.toThrow(/Connect your DroneDeploy/);
  });
});

describe("bringing a Matterport scan onto a job site", () => {
  it("links a scan from the vendor's account, held for review", async () => {
    await connectVendorMatterport(vendorCtx(), "tok-id", "tok-secret");
    const job = await issuedJob(["MATTERPORT"]);
    const link = await linkVendorMatterportSpace(vendorCtx(), job.id, job.sites[0].id, "SpaceAbc123");
    expect(link.captureJobSiteId).toBe(job.sites[0].id);
    expect(link.space.externalSpaceId).toBe("SpaceAbc123");
    await expect(linkVendorMatterportSpace(vendorCtx(), job.id, job.sites[0].id, "NotMine")).rejects.toMatchObject({ status: 404 });
  });
});

describe("adding an asset to rate", () => {
  it("lets the vendor on the job add one, and nobody else in the customer's team", async () => {
    const job = await issuedJob(["CONDITION_SCORES"]);
    const asset = await addSiteAsset(vendorCtx(), job.id, job.sites[0].id, { name: "RTU-09", assetType: "HVAC rooftop unit" });
    const stored = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stored.propertyId).toBe(site.id);
    await expect(
      addSiteAsset(viewerCtx(), job.id, job.sites[0].id, { name: "Nope", assetType: "Roof" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("finished drone files uploaded by hand", () => {
  async function stored(name: string) {
    const key = newObjectKey(org.id, name);
    await getStorageProvider().writeBytes(key, Buffer.from(`bytes-of-${name}`));
    return key;
  }

  it("files a map and a 3D model on the job site, held until approved, then ready for the customer", async () => {
    // The customer's own flight in progress on the same property must not
    // swallow the vendor's files.
    const customers = await createDroneCapture(staffCtx(), site.id, { capturedAt: new Date() });

    const job = await issuedJob(["DRONE"]);
    const jobSite = job.sites[0];
    const { captureId, datasetId } = await resolveDroneTargetForSite(vendorCtx(), job.id, jobSite.id);
    expect(captureId).not.toBe(customers.id);
    // Uploading in a second sitting goes to the same capture.
    expect((await resolveDroneTargetForSite(vendorCtx(), job.id, jobSite.id)).captureId).toBe(captureId);

    await registerDroneOutput(vendorCtx(), datasetId, { outputType: "ORTHOMOSAIC", storageKey: await stored("Store Orthomosaic.tif") });
    await registerDroneOutput(vendorCtx(), datasetId, { outputType: "ORTHOMOSAIC", storageKey: await stored("Store Orthomosaic-preview.jpg"), metadata: { preview: true } });
    await registerDroneOutput(vendorCtx(), datasetId, { outputType: "MESH_3D", storageKey: await stored("Store 3D Model.zip") });
    expect((await outstandingDeliverables(jobSite.id)).missing).not.toContain("DRONE");

    const visibleToCustomer = () => prisma.droneCapture.count({ where: { id: captureId, ...captureReviewWhere(viewerCtx()) } });
    expect(await visibleToCustomer()).toBe(0);

    await submitCaptureSite(vendorCtx(), job.id, jobSite.id);
    await reviewCaptureSite(asPlatform(staffCtx()), job.id, jobSite.id, { accept: true });
    expect(await visibleToCustomer()).toBe(1);
    expect((await prisma.droneCapture.findUniqueOrThrow({ where: { id: captureId } })).status).toBe("READY");
    // The customer's own capture is untouched.
    expect((await prisma.droneCapture.findUniqueOrThrow({ where: { id: customers.id } })).status).toBe("CREATED");
  });
});
