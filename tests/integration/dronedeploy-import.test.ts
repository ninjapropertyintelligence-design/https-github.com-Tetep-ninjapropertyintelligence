import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/tenant-scope";
import { ApiError } from "@/lib/api-error";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { getStorageProvider } from "@/lib/storage";
import {
  assignDroneDeployImport,
  connectDroneDeploy,
  filenameFromResponse,
  getDroneDeployStatus,
  MAX_EXPORT_ATTEMPTS,
  runDroneDeployImportForOrganization,
} from "@/lib/dronedeploy-import-service";
import { GET as cronGet } from "@/app/api/v1/cron/dronedeploy/route";

/**
 * DroneDeploy auto-import end to end, against a fake DroneDeploy.
 *
 * The fake answers the GraphQL operations the client sends and serves the
 * export download, so what is exercised is everything on our side: matching
 * by GPS, the state machine across passes, the streamed copy into storage,
 * and the capture ending READY exactly as a manual upload's does.
 */

const suffix = `dd${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const FILE_BYTES = Buffer.from("fake-geotiff-bytes-".repeat(200));

let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };
let near: { id: string };
let twinA: { id: string };

interface FakeState {
  validKeys: Set<string>;
  plans: Array<{ id: string; name: string; dateCreation: string; location: { lat: number; lng: number } | null }>;
  exportStatus: Map<string, string>;
  nextExportId: number;
  createExportCalls: number;
  failCreateExport: boolean;
}
let fake: FakeState;

function installFakeDroneDeploy() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://files.example.com/")) {
      return new Response(FILE_BYTES, {
        status: 200,
        headers: {
          "content-length": String(FILE_BYTES.length),
          "content-type": "image/tiff",
          "content-disposition": 'attachment; filename="orthomosaic.tif"',
        },
      });
    }
    if (!url.includes("dronedeploy.com/graphql")) throw new Error(`unexpected fetch ${url}`);

    const auth = new Headers(init?.headers).get("authorization") ?? "";
    if (!fake.validKeys.has(auth.replace("Bearer ", ""))) return new Response("nope", { status: 401 });

    const { query, variables } = JSON.parse(String(init?.body));
    const ok = (data: unknown) => Response.json({ data });
    if (query.includes("query Viewer")) return ok({ viewer: { username: "pilot@example.com" } });
    if (query.includes("query Plans")) {
      return ok({
        viewer: {
          organization: {
            plans: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: fake.plans.map((node) => ({ node })),
            },
          },
        },
      });
    }
    if (query.includes("mutation CreateExport")) {
      fake.createExportCalls++;
      if (fake.failCreateExport) return Response.json({ errors: [{ message: "Plan is still processing" }] });
      const id = `Export:${fake.nextExportId++}`;
      fake.exportStatus.set(id, "PROCESSING");
      return ok({ createExport: { export: { id } } });
    }
    if (query.includes("query GetExport")) {
      const status = fake.exportStatus.get(variables.id);
      if (!status) return ok({ node: null });
      return ok({
        node: { status, downloadPath: status === "COMPLETE" ? `https://files.example.com/${variables.id}.tif` : null },
      });
    }
    throw new Error(`unexpected query ${query}`);
  });
}

function ctxFor(orgId: string): SessionContext {
  return {
    userId: user.id,
    userName: "DD Test",
    userEmail: "dd@example.com",
    isPlatformAdmin: false,
    organizationId: orgId,
    organizationName: "DD Org",
    membershipId: "irrelevant",
    role: "OWNER" as never,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

beforeAll(async () => {
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "DD" } });
  org = await prisma.organization.create({ data: { name: `DD Org ${suffix}`, slug: `dd-org-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `DD Other ${suffix}`, slug: `dd-other-${suffix}` } });
  const portfolio = await prisma.portfolio.create({ data: { organizationId: org.id, name: "P" } });
  const base = { organizationId: org.id, portfolioId: portfolio.id, city: "Dallas", state: "TX", postalCode: "75201" };
  near = await prisma.property.create({
    data: { ...base, name: "Near", addressLine1: "1 Main", latitude: 32.7767, longitude: -96.797 },
  });
  // Two properties 40 m apart, far from "Near": a map over them is ambiguous.
  twinA = await prisma.property.create({
    data: { ...base, name: "Twin A", addressLine1: "2 Main", latitude: 32.9, longitude: -96.9 },
  });
  await prisma.property.create({
    data: { ...base, name: "Twin B", addressLine1: "3 Main", latitude: 32.90036, longitude: -96.9 },
  });
  await prisma.featureFlag.upsert({
    where: { key: FEATURE_FLAGS.DRONE_PROCESSING },
    create: { key: FEATURE_FLAGS.DRONE_PROCESSING, description: "drone (test)", defaultEnabled: true },
    update: {},
  });
  for (const o of [org, otherOrg]) {
    await prisma.featureFlagOverride.upsert({
      where: { flagKey_organizationId: { flagKey: FEATURE_FLAGS.DRONE_PROCESSING, organizationId: o.id } },
      create: { flagKey: FEATURE_FLAGS.DRONE_PROCESSING, organizationId: o.id, enabled: true },
      update: { enabled: true },
    });
  }
});

beforeEach(async () => {
  fake = {
    validKeys: new Set(["good-key"]),
    plans: [],
    exportStatus: new Map(),
    nextExportId: 1,
    createExportCalls: 0,
    failCreateExport: false,
  };
  installFakeDroneDeploy();
  await prisma.droneDeployImport.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
  await prisma.droneDeployConnection.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
  await prisma.droneCapture.deleteMany({ where: { property: { organizationId: org.id } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.organization.delete({ where: { id: otherOrg.id } });
  await prisma.user.delete({ where: { id: user.id } });
});

describe("connecting", () => {
  it("verifies the key before storing it, and never returns it", async () => {
    await expect(connectDroneDeploy(ctxFor(org.id), "bad-key")).rejects.toThrow(/rejected/);
    expect(await prisma.droneDeployConnection.findUnique({ where: { organizationId: org.id } })).toBeNull();

    const connection = await connectDroneDeploy(ctxFor(org.id), "good-key");
    expect(connection.status).toBe("CONNECTED");
    expect(JSON.stringify(connection)).not.toContain("good-key");
    const row = await prisma.droneDeployConnection.findUniqueOrThrow({ where: { organizationId: org.id } });
    expect(row.apiKeyEnc).not.toContain("good-key");
  });
});

describe("a map flown over one property", () => {
  it("is filed by GPS, exported, copied into storage and finishes READY across passes", async () => {
    await connectDroneDeploy(ctxFor(org.id), "good-key");
    fake.plans = [{ id: "MapPlan:1", name: "Roof survey", dateCreation: future(1), location: { lat: 32.7768, lng: -96.7971 } }];

    // Pass 1: discovered, matched, capture created, export requested.
    const first = await runDroneDeployImportForOrganization(org.id);
    expect(first).toMatchObject({ newMaps: 1, autoMatched: 1, exportsRequested: 1, exportsImported: 0 });
    const imp = await prisma.droneDeployImport.findFirstOrThrow({ where: { organizationId: org.id }, include: { capture: true } });
    expect(imp.status).toBe("IMPORTING");
    expect(imp.propertyId).toBe(near.id);
    expect(imp.matchedBy).toBe("GPS");
    expect(imp.capture?.status).toBe("PROCESSING");

    // Pass 2: DroneDeploy still building it — nothing changes, nothing is counted as a failure.
    const second = await runDroneDeployImportForOrganization(org.id);
    expect(second).toMatchObject({ newMaps: 0, exportsImported: 0, exportsFailed: 0 });
    expect(fake.createExportCalls).toBe(1);

    // Pass 3: complete — streamed in, registered, capture READY.
    fake.exportStatus.set("Export:1", "COMPLETE");
    const third = await runDroneDeployImportForOrganization(org.id);
    expect(third).toMatchObject({ exportsImported: 1, capturesCompleted: 1 });

    const done = await prisma.droneDeployImport.findUniqueOrThrow({
      where: { id: imp.id },
      include: { capture: { include: { datasets: { include: { outputs: true } } } }, exports: true },
    });
    expect(done.status).toBe("IMPORTED");
    expect(done.capture?.status).toBe("READY");
    const output = done.capture!.datasets[0].outputs[0];
    expect(output.outputType).toBe("ORTHOMOSAIC");
    expect(Number(output.sizeBytes)).toBe(FILE_BYTES.length);
    expect((output.metadata as Record<string, unknown>).originalFilename).toBe("orthomosaic.tif");
    const stored = await getStorageProvider().readBytes(output.storageKey);
    expect(stored?.equals(FILE_BYTES)).toBe(true);
    expect(done.capture!.datasets[0].provider).toBe("DRONEDEPLOY");

    // Pass 4: re-running is a no-op — no duplicate import, capture or export.
    const fourth = await runDroneDeployImportForOrganization(org.id);
    expect(fourth).toMatchObject({ newMaps: 0, exportsRequested: 0, exportsImported: 0 });
    expect(await prisma.droneDeployImport.count({ where: { organizationId: org.id } })).toBe(1);
    expect(await prisma.droneCapture.count({ where: { propertyId: near.id } })).toBe(1);
  });
});

describe("maps the importer must not guess about", () => {
  it("leaves no-location, nowhere-near and ambiguous maps for a person, and skips maps from before connecting", async () => {
    await connectDroneDeploy(ctxFor(org.id), "good-key");
    fake.plans = [
      { id: "MapPlan:old", name: "Old", dateCreation: "2020-01-01T00:00:00Z", location: { lat: 32.7767, lng: -96.797 } },
      { id: "MapPlan:noloc", name: "No location", dateCreation: future(1), location: null },
      { id: "MapPlan:far", name: "Far away", dateCreation: future(1), location: { lat: 40.7, lng: -74 } },
      { id: "MapPlan:twins", name: "Between twins", dateCreation: future(1), location: { lat: 32.90018, lng: -96.9 } },
    ];
    const result = await runDroneDeployImportForOrganization(org.id);
    expect(result).toMatchObject({ newMaps: 3, autoMatched: 0, unmatched: 3 });

    const imports = await prisma.droneDeployImport.findMany({ where: { organizationId: org.id } });
    expect(imports.map((i) => i.externalPlanId).sort()).toEqual(["MapPlan:far", "MapPlan:noloc", "MapPlan:twins"]);
    expect(imports.every((i) => i.status === "UNMATCHED" && i.captureId === null)).toBe(true);
    expect(imports.find((i) => i.externalPlanId === "MapPlan:twins")?.errorMessage).toMatch(/More than one property/);
    expect(fake.createExportCalls).toBe(0);

    // A person files the ambiguous one; it then imports like any other.
    const twins = imports.find((i) => i.externalPlanId === "MapPlan:twins")!;
    await assignDroneDeployImport(ctxFor(org.id), twins.id, twinA.id);
    await expect(assignDroneDeployImport(ctxFor(org.id), twins.id, twinA.id)).rejects.toThrow(/already been filed/);
    const after = await prisma.droneDeployImport.findUniqueOrThrow({ where: { id: twins.id } });
    expect(after).toMatchObject({ status: "IMPORTING", propertyId: twinA.id, matchedBy: "MANUAL" });
  });

  it("does not let another organization see or file this organization's maps", async () => {
    await connectDroneDeploy(ctxFor(org.id), "good-key");
    fake.plans = [{ id: "MapPlan:x", name: "X", dateCreation: future(1), location: null }];
    await runDroneDeployImportForOrganization(org.id);
    const imp = await prisma.droneDeployImport.findFirstOrThrow({ where: { organizationId: org.id } });

    await expect(assignDroneDeployImport(ctxFor(otherOrg.id), imp.id, near.id)).rejects.toThrow(ApiError);
    expect((await getDroneDeployStatus(ctxFor(otherOrg.id))).imports).toHaveLength(0);
  });
});

describe("failures", () => {
  it("gives up on an export after repeated errors and marks the capture FAILED", async () => {
    await connectDroneDeploy(ctxFor(org.id), "good-key");
    fake.failCreateExport = true;
    fake.plans = [{ id: "MapPlan:bad", name: "Bad", dateCreation: future(1), location: { lat: 32.7767, lng: -96.797 } }];
    for (let i = 0; i < MAX_EXPORT_ATTEMPTS; i++) await runDroneDeployImportForOrganization(org.id);

    const imp = await prisma.droneDeployImport.findFirstOrThrow({
      where: { organizationId: org.id },
      include: { capture: true, exports: true },
    });
    expect(imp.exports[0]).toMatchObject({ status: "FAILED", attempts: MAX_EXPORT_ATTEMPTS });
    expect(imp.status).toBe("FAILED");
    expect(imp.capture?.status).toBe("FAILED");
  });

  it("marks the connection ERROR when DroneDeploy stops accepting the key", async () => {
    await connectDroneDeploy(ctxFor(org.id), "good-key");
    fake.validKeys.clear();
    const result = await runDroneDeployImportForOrganization(org.id);
    expect(result.error).toMatch(/rejected/);
    const row = await prisma.droneDeployConnection.findUniqueOrThrow({ where: { organizationId: org.id } });
    expect(row.status).toBe("ERROR");
  });

  it("skips an organization whose drone entitlement has lapsed", async () => {
    await connectDroneDeploy(ctxFor(org.id), "good-key");
    await prisma.featureFlagOverride.update({
      where: { flagKey_organizationId: { flagKey: FEATURE_FLAGS.DRONE_PROCESSING, organizationId: org.id } },
      data: { enabled: false },
    });
    try {
      fake.plans = [{ id: "MapPlan:y", name: "Y", dateCreation: future(1), location: null }];
      const result = await runDroneDeployImportForOrganization(org.id);
      expect(result.skipped).toMatch(/not enabled/);
      expect(await prisma.droneDeployImport.count({ where: { organizationId: org.id } })).toBe(0);
    } finally {
      await prisma.featureFlagOverride.update({
        where: { flagKey_organizationId: { flagKey: FEATURE_FLAGS.DRONE_PROCESSING, organizationId: org.id } },
        data: { enabled: true },
      });
    }
  });
});

describe("the cron route", () => {
  it("is closed without CRON_SECRET and rejects a wrong secret", async () => {
    const before = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect((await cronGet(new Request("http://x/api/v1/cron/dronedeploy"))).status).toBe(401);
      process.env.CRON_SECRET = "s3cret";
      const wrong = new Request("http://x/api/v1/cron/dronedeploy", { headers: { authorization: "Bearer nope" } });
      expect((await cronGet(wrong)).status).toBe(401);
    } finally {
      if (before === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = before;
    }
  });
});

describe("filenameFromResponse", () => {
  it("prefers Content-Disposition, then the URL path, then the fallback", () => {
    const withHeader = new Response(null, { headers: { "content-disposition": "attachment; filename*=UTF-8''site%20ortho.zip" } });
    expect(filenameFromResponse(withHeader, "https://x/y", "f.bin")).toBe("site ortho.zip");
    expect(filenameFromResponse(new Response(null), "https://x/a/dsm.tif?sig=1", "f.bin")).toBe("dsm.tif");
    expect(filenameFromResponse(new Response(null), "https://x/download", "f.bin")).toBe("f.bin");
  });
});
