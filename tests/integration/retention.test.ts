import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { Role } from "@/generated/prisma/client";
import {
  DEFAULT_POLICY,
  cancelDeletionRequest,
  executeDeletionRequest,
  getRetentionPolicy,
  listDeletionRequests,
  placeLegalHold,
  releaseLegalHold,
  requestPropertyDeletion,
  runDueDeletions,
  updateRetentionPolicy,
} from "@/lib/retention";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Data retention (§52) and secure deletion (§54) against real Postgres and
 * the real storage provider.
 *
 * The load-bearing assertion in this file is that the object-storage surface
 * removes actual bytes from disk. §54's whole point is "delete does not mean
 * hiding a row" — a test that only checked the database would have passed
 * against the no-op `delete()` this work had to replace.
 */
const suffix = `ret${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const STORAGE_ROOT = path.join(process.cwd(), ".local-storage");

let org: { id: string };
let user: { id: string };
let portfolioId: string;

async function fileExists(key: string): Promise<boolean> {
  try {
    await access(path.join(STORAGE_ROOT, key));
    return true;
  } catch {
    return false;
  }
}

/** Writes a real file at `key` so deletion has something to actually remove. */
async function putObject(key: string, contents: string): Promise<string> {
  const full = path.join(STORAGE_ROOT, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents);
  return key;
}

function ctxFor(): SessionContext {
  return {
    userId: user.id,
    userName: "Retention User",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Retention Org",
    membershipId: "irrelevant",
    role: Role.OWNER,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

/**
 * A property with something on every surface a deletion has to reach:
 * evidence (original + thumbnail), a document with a version and search
 * index chunks, and a drone dataset with an image and a derived output.
 */
async function seedPropertyWithArtifacts(name: string) {
  const property = await prisma.property.create({
    data: {
      organizationId: org.id,
      portfolioId,
      name,
      addressLine1: "1 Main St",
      city: "Testville",
      state: "TX",
      postalCode: "75001",
    },
  });

  const evidenceKey = await putObject(`${org.id}/${property.id}-evidence.jpg`, "evidence bytes");
  const thumbKey = await putObject(`${org.id}/${property.id}-evidence-thumb.jpg`, "thumb bytes");
  await prisma.evidence.create({
    data: {
      organizationId: org.id,
      propertyId: property.id,
      type: "PHOTO",
      uploadedById: user.id,
      storageKey: evidenceKey,
      thumbnailKey: thumbKey,
    },
  });

  const doc = await prisma.document.create({
    data: { organizationId: org.id, propertyId: property.id, title: "Warranty", documentType: "WARRANTY" },
  });
  const docKey = await putObject(`${org.id}/${property.id}-warranty.pdf`, "pdf bytes");
  await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      versionNumber: 1,
      originalFilename: "warranty.pdf",
      mimeType: "application/pdf",
      sizeBytes: 9,
      storageKey: docKey,
      uploadedById: user.id,
    },
  });
  await prisma.documentChunk.createMany({
    data: [0, 1, 2].map((i) => ({
      organizationId: org.id,
      documentId: doc.id,
      propertyId: property.id,
      chunkIndex: i,
      content: `chunk ${i}`,
    })),
  });

  const capture = await prisma.droneCapture.create({
    data: { propertyId: property.id, status: "READY", capturedAt: new Date() },
  });
  const dataset = await prisma.droneDataset.create({ data: { captureId: capture.id } });
  const imageKey = await putObject(`${org.id}/${property.id}-drone.jpg`, "drone bytes");
  await prisma.droneImage.create({ data: { datasetId: dataset.id, storageKey: imageKey } });
  const outputKey = await putObject(`${org.id}/${property.id}-ortho.tif`, "ortho bytes");
  await prisma.droneOutput.create({
    data: { datasetId: dataset.id, outputType: "ORTHOMOSAIC", storageKey: outputKey },
  });

  return {
    property,
    keys: { evidenceKey, thumbKey, docKey, imageKey, outputKey },
    allKeys: [evidenceKey, thumbKey, docKey, imageKey, outputKey],
    derivedKeys: [outputKey, thumbKey],
  };
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `Ret Org ${suffix}`, slug: `ret-org-${suffix}` } });
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "Ret User" } });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: Role.OWNER } });
  const portfolio = await prisma.portfolio.create({ data: { organizationId: org.id, name: "P" } });
  portfolioId = portfolio.id;
});

beforeEach(async () => {
  await prisma.deletionRequest.deleteMany({ where: { organizationId: org.id } });
  await prisma.legalHold.deleteMany({ where: { organizationId: org.id } });
});

afterAll(async () => {
  // Organization first: Evidence references the user, and only the org
  // cascade removes it. Deleting the user first hits that foreign key.
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
});

describe("retention policy (spec §52)", () => {
  it("returns defaults without silently creating a row", async () => {
    const policy = await getRetentionPolicy(org.id);
    expect(policy.deletedPropertyGraceDays).toBe(DEFAULT_POLICY.deletedPropertyGraceDays);
    // "Was a policy ever set?" must stay answerable — reading must not write.
    expect(await prisma.retentionPolicy.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("covers every category spec §52 names", async () => {
    const policy = await getRetentionPolicy(org.id);
    for (const field of [
      "activePropertyRetentionDays",
      "deletedPropertyGraceDays",
      "deletedOrganizationGraceDays",
      "archivedCaptureRetentionDays",
      "customerTerminationGraceDays",
      "backupRetentionDays",
    ]) {
      expect(policy).toHaveProperty(field);
    }
  });

  it("persists an update and audits it", async () => {
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 7, backupRetentionDays: 90 });
    const policy = await getRetentionPolicy(org.id);
    expect(policy.deletedPropertyGraceDays).toBe(7);
    expect(policy.backupRetentionDays).toBe(90);

    const log = await prisma.auditLog.findFirst({
      where: { organizationId: org.id, action: "retention.policy_updated" },
    });
    expect(log).toBeTruthy();

    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0, backupRetentionDays: 35 });
  });
});

describe("deletion request lifecycle", () => {
  it("schedules for the grace window and marks the property rather than hiding it", async () => {
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 30 });
    const { property } = await seedPropertyWithArtifacts(`Grace ${suffix}`);

    const request = await requestPropertyDeletion(ctxFor(), property.id, "Store closed permanently");
    expect(request.status).toBe("PENDING");
    expect(request.scheduledFor.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const after = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    // Still there, still readable — that is what a grace window is for.
    expect(after.retentionStatus).toBe("SCHEDULED_FOR_DELETION");

    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0 });
  });

  it("is not executed before its scheduled time", async () => {
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 30 });
    const { property } = await seedPropertyWithArtifacts(`NotYet ${suffix}`);
    await requestPropertyDeletion(ctxFor(), property.id, "Store closed permanently");

    await runDueDeletions();
    expect(await prisma.property.findUnique({ where: { id: property.id } })).not.toBeNull();

    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0 });
  });

  it("can be cancelled during the window, restoring the property", async () => {
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 30 });
    const { property } = await seedPropertyWithArtifacts(`Cancel ${suffix}`);
    const request = await requestPropertyDeletion(ctxFor(), property.id, "Requested in error");

    await cancelDeletionRequest(ctxFor(), request.id);
    const after = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(after.retentionStatus).toBe("ACTIVE");

    // A cancelled request must not then run.
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0 });
    await runDueDeletions();
    expect(await prisma.property.findUnique({ where: { id: property.id } })).not.toBeNull();
  });

  it("refuses a duplicate pending request", async () => {
    const { property } = await seedPropertyWithArtifacts(`Dup ${suffix}`);
    await requestPropertyDeletion(ctxFor(), property.id, "Store closed permanently");
    await expect(requestPropertyDeletion(ctxFor(), property.id, "again")).rejects.toThrow(/already scheduled/);
  });

  it("refuses a property in another organization", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: `Ret Other ${suffix}`, slug: `ret-other-${suffix}` },
    });
    const otherPortfolio = await prisma.portfolio.create({ data: { organizationId: otherOrg.id, name: "P" } });
    const foreign = await prisma.property.create({
      data: {
        organizationId: otherOrg.id,
        portfolioId: otherPortfolio.id,
        name: "Foreign",
        addressLine1: "1",
        city: "C",
        state: "TX",
        postalCode: "75001",
      },
    });
    try {
      await expect(requestPropertyDeletion(ctxFor(), foreign.id, "not mine")).rejects.toThrow(ApiError);
    } finally {
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });
});

describe("secure deletion — all six surfaces (spec §54)", () => {
  it("removes the real bytes from object storage, not just the database rows", async () => {
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0 });
    const seeded = await seedPropertyWithArtifacts(`Purge ${suffix}`);

    // Everything is genuinely on disk before we start.
    for (const key of seeded.allKeys) {
      expect(await fileExists(key), `${key} should exist before deletion`).toBe(true);
    }

    const request = await requestPropertyDeletion(ctxFor(), seeded.property.id, "Store closed permanently");
    const result = await executeDeletionRequest(request.id);
    expect(result.status).toBe("COMPLETED");

    // THE assertion. A no-op storage provider would sail through a
    // database-only check while leaving every one of these on disk.
    for (const key of seeded.allKeys) {
      expect(await fileExists(key), `${key} should be gone after deletion`).toBe(false);
    }
  });

  it("records an outcome for every one of the six surfaces", async () => {
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0 });
    const seeded = await seedPropertyWithArtifacts(`Surfaces ${suffix}`);
    const request = await requestPropertyDeletion(ctxFor(), seeded.property.id, "Store closed permanently");
    await executeDeletionRequest(request.id);

    const surfaces = await prisma.deletionSurfaceResult.findMany({ where: { requestId: request.id } });
    const bySurface = new Map(surfaces.map((s) => [s.surface, s]));

    for (const surface of [
      "DATABASE",
      "OBJECT_STORAGE",
      "SEARCH_INDEX",
      "DERIVED_FILES",
      "CACHE",
      "BACKUP_RETENTION",
    ] as const) {
      expect(bySurface.has(surface), `missing outcome for ${surface}`).toBe(true);
    }

    expect(bySurface.get("DATABASE")!.status).toBe("COMPLETED");
    expect(bySurface.get("OBJECT_STORAGE")!.status).toBe("COMPLETED");
    expect(bySurface.get("OBJECT_STORAGE")!.itemCount).toBe(seeded.allKeys.length);
    expect(bySurface.get("SEARCH_INDEX")!.itemCount).toBe(3);
    expect(bySurface.get("DERIVED_FILES")!.itemCount).toBe(seeded.derivedKeys.length);

    // The two honest non-successes. Reporting these as COMPLETED would be
    // claiming work that never happened.
    expect(bySurface.get("CACHE")!.status).toBe("NOT_APPLICABLE");
    const backup = bySurface.get("BACKUP_RETENTION")!;
    expect(backup.status).toBe("SCHEDULED");
    expect(backup.detail).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("empties the search index for the deleted property", async () => {
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0 });
    const seeded = await seedPropertyWithArtifacts(`Index ${suffix}`);
    expect(await prisma.documentChunk.count({ where: { propertyId: seeded.property.id } })).toBe(3);

    const request = await requestPropertyDeletion(ctxFor(), seeded.property.id, "Store closed permanently");
    await executeDeletionRequest(request.id);

    expect(await prisma.documentChunk.count({ where: { propertyId: seeded.property.id } })).toBe(0);
  });

  it("leaves a readable record of what was deleted after the target is gone", async () => {
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0 });
    const seeded = await seedPropertyWithArtifacts(`Record ${suffix}`);
    const request = await requestPropertyDeletion(ctxFor(), seeded.property.id, "Store closed permanently");
    await executeDeletionRequest(request.id);

    expect(await prisma.property.findUnique({ where: { id: seeded.property.id } })).toBeNull();

    const requests = await listDeletionRequests(ctxFor());
    const record = requests.find((r) => r.id === request.id)!;
    // The label is denormalised precisely so this still means something.
    expect(record.targetLabel).toBe(`Record ${suffix}`);
    expect(record.status).toBe("COMPLETED");
    expect(record.surfaces).toHaveLength(6);

    const log = await prisma.auditLog.findFirst({
      where: { organizationId: org.id, action: "retention.deletion_completed" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).toBeTruthy();
  });

  it("runDueDeletions executes only what is actually due", async () => {
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0 });
    const due = await seedPropertyWithArtifacts(`Due ${suffix}`);
    await requestPropertyDeletion(ctxFor(), due.property.id, "Store closed permanently");

    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 30 });
    const notDue = await seedPropertyWithArtifacts(`NotDue ${suffix}`);
    await requestPropertyDeletion(ctxFor(), notDue.property.id, "Store closed permanently");

    const results = await runDueDeletions();
    expect(results.filter((r) => r.status === "COMPLETED")).toHaveLength(1);
    expect(await prisma.property.findUnique({ where: { id: due.property.id } })).toBeNull();
    expect(await prisma.property.findUnique({ where: { id: notDue.property.id } })).not.toBeNull();

    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0 });
  });
});

describe("legal hold (spec §52)", () => {
  it("blocks a new deletion request outright", async () => {
    const { property } = await seedPropertyWithArtifacts(`Held ${suffix}`);
    await placeLegalHold(ctxFor(), { scopeType: "PROPERTY", propertyId: property.id, reason: "Litigation 2026-14" });

    await expect(requestPropertyDeletion(ctxFor(), property.id, "Store closed")).rejects.toThrow(/legal hold/i);
  });

  it("blocks execution of a request made BEFORE the hold was placed", async () => {
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0 });
    const seeded = await seedPropertyWithArtifacts(`LateHold ${suffix}`);
    const request = await requestPropertyDeletion(ctxFor(), seeded.property.id, "Store closed permanently");

    // The case holds exist for: the request was already in flight.
    await placeLegalHold(ctxFor(), {
      scopeType: "PROPERTY",
      propertyId: seeded.property.id,
      reason: "Litigation 2026-14",
    });

    const result = await executeDeletionRequest(request.id);
    expect(result.status).toBe("BLOCKED_BY_LEGAL_HOLD");
    expect(await prisma.property.findUnique({ where: { id: seeded.property.id } })).not.toBeNull();
    // Nothing was destroyed on any surface.
    for (const key of seeded.allKeys) {
      expect(await fileExists(key)).toBe(true);
    }
  });

  it("an organization-scoped hold covers every property in it", async () => {
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0 });
    const seeded = await seedPropertyWithArtifacts(`OrgHold ${suffix}`);
    await placeLegalHold(ctxFor(), { scopeType: "ORGANIZATION", reason: "Regulatory inquiry" });

    await expect(requestPropertyDeletion(ctxFor(), seeded.property.id, "Store closed")).rejects.toThrow(/legal hold/i);
  });

  it("releasing a hold keeps the record of when it was in force", async () => {
    const hold = await placeLegalHold(ctxFor(), { scopeType: "ORGANIZATION", reason: "Regulatory inquiry" });
    const released = await releaseLegalHold(ctxFor(), hold.id);

    expect(released.releasedAt).toBeInstanceOf(Date);
    expect(released.releasedByUserId).toBe(user.id);
    // The row survives: when a hold was in force, and who lifted it, is what
    // gets asked about later.
    expect(await prisma.legalHold.findUnique({ where: { id: hold.id } })).not.toBeNull();
  });

  it("a released hold no longer blocks deletion", async () => {
    await updateRetentionPolicy(ctxFor(), { deletedPropertyGraceDays: 0 });
    const seeded = await seedPropertyWithArtifacts(`Released ${suffix}`);
    const hold = await placeLegalHold(ctxFor(), { scopeType: "ORGANIZATION", reason: "Regulatory inquiry" });
    await releaseLegalHold(ctxFor(), hold.id);

    const request = await requestPropertyDeletion(ctxFor(), seeded.property.id, "Store closed permanently");
    expect((await executeDeletionRequest(request.id)).status).toBe("COMPLETED");
  });

  it("a hold in one organization does not block another's deletion", async () => {
    await placeLegalHold(ctxFor(), { scopeType: "ORGANIZATION", reason: "Regulatory inquiry" });

    const otherOrg = await prisma.organization.create({
      data: { name: `Ret Third ${suffix}`, slug: `ret-third-${suffix}` },
    });
    try {
      const held = await prisma.legalHold.findFirst({ where: { organizationId: otherOrg.id, releasedAt: null } });
      expect(held).toBeNull();
    } finally {
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });
});
