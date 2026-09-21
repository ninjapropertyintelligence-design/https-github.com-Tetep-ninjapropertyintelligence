import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { Role, StorageObjectKind, StorageRestoreState, StorageTier } from "@/generated/prisma/client";
import {
  __setStorageProviderForTest,
  type RestoreResult,
  type StorageCapabilities,
  type StorageProvider,
  type StorageTierName,
  type TierTransitionResult,
} from "@/lib/storage";
import {
  registerStorageObject,
  requestRestore,
  runTieringForOrganization,
  summarizeStorageByTier,
  updateTieringPolicy,
} from "@/lib/storage-tiering";
import type { SessionContext } from "@/lib/tenant-scope";
import { createDroneCapture, createDroneDataset, registerDroneImage } from "@/lib/drone-service";

/**
 * Storage lifecycle tiering (§51) against real Postgres.
 *
 * The cases that matter are the ones where the ledger could drift from
 * reality: a store that cannot tier, a transition that fails, and a policy
 * that would move an object backwards. Any of those, recorded optimistically,
 * produces a cost report that is confidently wrong.
 */

const suffix = `st${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };

function ctxFor(orgId: string): SessionContext {
  return {
    userId: user.id,
    userName: "ST User",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: orgId,
    organizationName: "ST Org",
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

/** A store that tiers, and records exactly what it was asked to do. */
class FakeTieringProvider implements StorageProvider {
  transitions: { key: string; tier: StorageTierName }[] = [];
  restores: { key: string; days: number }[] = [];
  failOnKey: string | null = null;
  supportsTiering = true;

  capabilities(): StorageCapabilities {
    return { tiering: this.supportsTiering };
  }
  async transitionTier(key: string, tier: StorageTierName): Promise<TierTransitionResult> {
    if (!this.supportsTiering) {
      return { status: "NOT_SUPPORTED", reason: "fake store has one storage class" };
    }
    if (this.failOnKey === key) {
      return { status: "FAILED", reason: "simulated store failure" };
    }
    this.transitions.push({ key, tier });
    return { status: "TRANSITIONED", tier };
  }
  async restoreObject(key: string, days: number): Promise<RestoreResult> {
    this.restores.push({ key, days });
    return { status: "REQUESTED", availableAfter: new Date(Date.now() + days * 86_400_000) };
  }
  async createUploadUrl() {
    return { url: "", method: "PUT" as const, key: "", expiresAt: new Date().toISOString() };
  }
  async getDownloadUrl() {
    return "";
  }
  async delete() {}
  async verifyUpload() {
    return { exists: true, actualSizeBytes: 1, actualChecksumSha256: null };
  }
  async readBytes() {
    return null;
  }
  async writeBytes() {}
}

let provider: FakeTieringProvider;

/** Registers an object whose age is controlled rather than "now". */
async function seedObject(orgId: string, key: string, ageDays: number, sizeBytes = 1_000_000) {
  return registerStorageObject({
    organizationId: orgId,
    storageKey: key,
    kind: StorageObjectKind.DRONE_IMAGE,
    sizeBytes,
    objectCreatedAt: new Date(Date.now() - ageDays * 86_400_000),
  });
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `ST Org ${suffix}`, slug: `st-org-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `ST Other ${suffix}`, slug: `st-other-${suffix}` } });
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "ST User" } });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: Role.OWNER } });
});

beforeEach(async () => {
  await prisma.storageObject.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
  await prisma.storageTieringPolicy.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
  provider = new FakeTieringProvider();
  __setStorageProviderForTest(provider);
});

afterAll(async () => {
  __setStorageProviderForTest(null);
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
  await prisma.user.deleteMany({ where: { id: user.id } });
});

describe("tiering policy validation", () => {
  it("rejects thresholds that do not get colder as they get longer", async () => {
    // archive before infrequent access would have objects oscillating between
    // tiers on every run, paying a copy each time.
    await expect(
      updateTieringPolicy(ctxFor(org.id), {
        enabled: true,
        infrequentAccessAfterDays: 90,
        archiveAfterDays: 30,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects equal thresholds, which are just as ambiguous as inverted ones", async () => {
    await expect(
      updateTieringPolicy(ctxFor(org.id), {
        enabled: true,
        infrequentAccessAfterDays: 90,
        archiveAfterDays: 90,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a negative threshold", async () => {
    await expect(
      updateTieringPolicy(ctxFor(org.id), { enabled: true, infrequentAccessAfterDays: -1 }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("accepts a policy that skips a tier", async () => {
    const saved = await updateTieringPolicy(ctxFor(org.id), {
      enabled: true,
      infrequentAccessAfterDays: null,
      archiveAfterDays: 365,
    });
    expect(saved.archiveAfterDays).toBe(365);
    expect(saved.infrequentAccessAfterDays).toBeNull();
  });
});

describe("tiering runner", () => {
  it("does nothing at all when the organization has not opted in", async () => {
    await seedObject(org.id, "k-old", 5000);
    const summary = await runTieringForOrganization(org.id);
    expect(summary.transitioned).toBe(0);
    expect(summary.notSupportedReason).toMatch(/not enabled/i);
    // The decisive assertion: the store was never called.
    expect(provider.transitions).toHaveLength(0);
  });

  it("moves an object past its threshold and records the tier that was reached", async () => {
    await updateTieringPolicy(ctxFor(org.id), { enabled: true, infrequentAccessAfterDays: 90 });
    await seedObject(org.id, "k-cold", 120);

    const summary = await runTieringForOrganization(org.id);
    expect(summary.transitioned).toBe(1);
    expect(provider.transitions).toEqual([{ key: "k-cold", tier: "INFREQUENT_ACCESS" }]);

    const row = await prisma.storageObject.findFirstOrThrow({ where: { storageKey: "k-cold" } });
    expect(row.currentTier).toBe(StorageTier.INFREQUENT_ACCESS);
    expect(row.lastTransitionedAt).not.toBeNull();
  });

  it("leaves an object that is not yet old enough alone", async () => {
    await updateTieringPolicy(ctxFor(org.id), { enabled: true, infrequentAccessAfterDays: 90 });
    await seedObject(org.id, "k-warm", 10);

    const summary = await runTieringForOrganization(org.id);
    expect(summary.skipped).toBe(1);
    expect(provider.transitions).toHaveLength(0);
  });

  it("is idempotent — a second run does not re-transition what it already moved", async () => {
    // Each transition is a billable copy, so re-running a schedule must not
    // cost anything for objects already in place.
    await updateTieringPolicy(ctxFor(org.id), { enabled: true, infrequentAccessAfterDays: 90 });
    await seedObject(org.id, "k-cold", 120);

    await runTieringForOrganization(org.id);
    const second = await runTieringForOrganization(org.id);

    expect(second.transitioned).toBe(0);
    expect(provider.transitions).toHaveLength(1);
  });

  it("never moves an object back to a warmer tier", async () => {
    // Warming up multiplies the bill silently. Only an explicit restore does that.
    await updateTieringPolicy(ctxFor(org.id), {
      enabled: true,
      infrequentAccessAfterDays: 90,
      archiveAfterDays: 365,
    });
    const seeded = await seedObject(org.id, "k-archived", 400);
    await prisma.storageObject.update({
      where: { id: seeded.id },
      data: { currentTier: StorageTier.DEEP_ARCHIVE },
    });

    const summary = await runTieringForOrganization(org.id);
    expect(summary.transitioned).toBe(0);
    expect(provider.transitions).toHaveLength(0);
  });

  it("jumps straight to the coldest qualifying tier rather than stepping through", async () => {
    await updateTieringPolicy(ctxFor(org.id), {
      enabled: true,
      infrequentAccessAfterDays: 90,
      archiveAfterDays: 365,
      deepArchiveAfterDays: 1095,
    });
    await seedObject(org.id, "k-ancient", 2000);

    await runTieringForOrganization(org.id);
    expect(provider.transitions).toEqual([{ key: "k-ancient", tier: "DEEP_ARCHIVE" }]);
  });

  it("does NOT record a tier change when the store reports the transition failed", async () => {
    /**
     * The core honesty property. A ledger that recorded the intended tier
     * would tell the customer their data is in Glacier while it sits in
     * Standard, and bill them accordingly.
     */
    await updateTieringPolicy(ctxFor(org.id), { enabled: true, infrequentAccessAfterDays: 90 });
    await seedObject(org.id, "k-fails", 120);
    provider.failOnKey = "k-fails";

    const summary = await runTieringForOrganization(org.id);
    expect(summary.failed).toBe(1);
    expect(summary.transitioned).toBe(0);

    const row = await prisma.storageObject.findFirstOrThrow({ where: { storageKey: "k-fails" } });
    expect(row.currentTier).toBe(StorageTier.STANDARD);
    expect(row.lastTransitionedAt).toBeNull();
  });

  it("reports NOT_SUPPORTED once, without touching any row, on a single-class store", async () => {
    await updateTieringPolicy(ctxFor(org.id), { enabled: true, infrequentAccessAfterDays: 90 });
    await seedObject(org.id, "k-a", 120);
    await seedObject(org.id, "k-b", 200);
    provider.supportsTiering = false;

    const summary = await runTieringForOrganization(org.id);
    expect(summary.notSupportedReason).toMatch(/one storage class/i);
    expect(summary.transitioned).toBe(0);

    const rows = await prisma.storageObject.findMany({ where: { organizationId: org.id } });
    expect(rows.every((r) => r.currentTier === StorageTier.STANDARD)).toBe(true);
  });

  it("does not touch another organization's objects", async () => {
    await updateTieringPolicy(ctxFor(org.id), { enabled: true, infrequentAccessAfterDays: 90 });
    await seedObject(org.id, "mine", 120);
    await seedObject(otherOrg.id, "theirs", 120);

    await runTieringForOrganization(org.id);
    expect(provider.transitions.map((t) => t.key)).toEqual(["mine"]);

    const theirs = await prisma.storageObject.findFirstOrThrow({ where: { storageKey: "theirs" } });
    expect(theirs.currentTier).toBe(StorageTier.STANDARD);
  });
});

describe("registerStorageObject", () => {
  it("is idempotent and never resets a tier the runner has set", async () => {
    // Upload-time registration and backfill overlap; a re-register that reset
    // the tier would silently undo real transitions.
    const first = await seedObject(org.id, "k-dup", 120);
    await prisma.storageObject.update({
      where: { id: first.id },
      data: { currentTier: StorageTier.ARCHIVE },
    });

    await seedObject(org.id, "k-dup", 120, 2_000_000);

    const rows = await prisma.storageObject.findMany({ where: { storageKey: "k-dup" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].currentTier).toBe(StorageTier.ARCHIVE);
    expect(Number(rows[0].sizeBytes)).toBe(2_000_000);
  });
});

describe("restore", () => {
  it("does not call the store for an object that is directly readable", async () => {
    await seedObject(org.id, "k-warm", 10);
    const { outcome } = await requestRestore(ctxFor(org.id), "k-warm");
    expect(outcome.status).toBe("ALREADY_AVAILABLE");
    expect(provider.restores).toHaveLength(0);
  });

  it("requests a restore for a deep-archived object and records it as IN PROGRESS", async () => {
    // Not AVAILABLE. The bytes are not back yet and saying otherwise would
    // send the UI to fetch an object that still 403s.
    const seeded = await seedObject(org.id, "k-deep", 2000);
    await prisma.storageObject.update({
      where: { id: seeded.id },
      data: { currentTier: StorageTier.DEEP_ARCHIVE },
    });

    const { object, outcome } = await requestRestore(ctxFor(org.id), "k-deep", 3);
    expect(outcome.status).toBe("REQUESTED");
    expect(provider.restores).toEqual([{ key: "k-deep", days: 3 }]);
    expect(object.restoreState).toBe(StorageRestoreState.IN_PROGRESS);
    expect(object.restoreExpiresAt).not.toBeNull();
  });

  it("refuses to restore an object belonging to another organization", async () => {
    await seedObject(otherOrg.id, "not-yours", 2000);
    await expect(requestRestore(ctxFor(org.id), "not-yours")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("summarizeStorageByTier", () => {
  it("reports bytes and counts per tier, with zeroes for empty tiers", async () => {
    // Cost reporting (§49/§50) consumes this, so an absent tier must read as
    // zero rather than be missing from the object.
    await seedObject(org.id, "s1", 10, 1000);
    const s2 = await seedObject(org.id, "s2", 10, 2000);
    await prisma.storageObject.update({
      where: { id: s2.id },
      data: { currentTier: StorageTier.ARCHIVE },
    });

    const summary = await summarizeStorageByTier(org.id);
    expect(summary.byTier.STANDARD).toEqual({ objects: 1, bytes: 1000 });
    expect(summary.byTier.ARCHIVE).toEqual({ objects: 1, bytes: 2000 });
    expect(summary.byTier.DEEP_ARCHIVE).toEqual({ objects: 0, bytes: 0 });
    // Totals span every tier, so a summary cannot under-report an
    // organization's footprint just because the bytes moved to a cold tier.
    expect(summary.totalObjects).toBe(2);
    expect(summary.totalBytes).toBe(3000);
  });

  it("scopes the summary to one organization", async () => {
    await seedObject(org.id, "mine", 10, 500);
    await seedObject(otherOrg.id, "theirs", 10, 9_000_000);
    const summary = await summarizeStorageByTier(org.id);
    expect(summary.byTier.STANDARD.bytes).toBe(500);
  });
});

/**
 * The ledger is only worth anything if real uploads land in it. These assert
 * the wiring itself: without it every test above still passes while no
 * customer object is ever tiered, because nothing would have registered one.
 */
describe("upload paths register objects for tiering", () => {
  it("records a drone image when it is registered", async () => {
    const portfolio = await prisma.portfolio.create({
      data: { organizationId: org.id, name: "Tiering P" },
    });
    const property = await prisma.property.create({
      data: {
        organizationId: org.id,
        portfolioId: portfolio.id,
        name: "Tiering Prop",
        addressLine1: "1 Main St",
        city: "Testville",
        state: "TX",
        postalCode: "75001",
      },
    });
    const ctx = ctxFor(org.id);
    const capture = await createDroneCapture(ctx, property.id, {});
    const dataset = await createDroneDataset(ctx, capture.id);

    const key = `${org.id}/drone/${suffix}-wired.jpg`;
    await registerDroneImage(ctx, dataset.id, { storageKey: key });

    const recorded = await prisma.storageObject.findUnique({
      where: { organizationId_storageKey: { organizationId: org.id, storageKey: key } },
    });
    expect(recorded).not.toBeNull();
    expect(recorded!.kind).toBe(StorageObjectKind.DRONE_IMAGE);
    // A freshly uploaded object starts hot; only the runner may move it.
    expect(recorded!.currentTier).toBe(StorageTier.STANDARD);

    await prisma.property.delete({ where: { id: property.id } });
    await prisma.portfolio.delete({ where: { id: portfolio.id } });
  });
});
