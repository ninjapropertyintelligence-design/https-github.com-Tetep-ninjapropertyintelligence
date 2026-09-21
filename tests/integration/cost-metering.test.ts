import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { Role, StorageObjectKind, StorageTier, UsageMetricType } from "@/generated/prisma/client";
import {
  recordUsage,
  resolveRate,
  sampleStorageUsage,
  setRate,
  summarizePropertyCogs,
} from "@/lib/cost-metering";
import { registerStorageObject } from "@/lib/storage-tiering";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Cost metering and property-level COGS (§49/§50) against real Postgres.
 *
 * The cases that matter are the ones where a number could look authoritative
 * and be wrong: usage with no rate priced as free, overhead silently spread
 * across properties, a period straddling a price change priced at one rate,
 * and storage summed as though it were an event.
 */

const suffix = `cm${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };
let propertyA: { id: string };
let propertyB: { id: string };

function ctxFor(orgId: string): SessionContext {
  return {
    userId: user.id,
    userName: "CM User",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: orgId,
    organizationName: "CM Org",
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

const JAN = new Date("2026-01-15T00:00:00Z");
const FEB = new Date("2026-02-15T00:00:00Z");
const WINDOW_START = new Date("2026-01-01T00:00:00Z");
const WINDOW_END = new Date("2026-03-01T00:00:00Z");

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `CM Org ${suffix}`, slug: `cm-org-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `CM Other ${suffix}`, slug: `cm-other-${suffix}` } });
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "CM User" } });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: Role.OWNER } });
  const portfolio = await prisma.portfolio.create({ data: { organizationId: org.id, name: "CM P" } });
  propertyA = await prisma.property.create({
    data: { organizationId: org.id, portfolioId: portfolio.id, name: "Prop A", addressLine1: "1 Main St", city: "Testville", state: "TX", postalCode: "75001" },
  });
  propertyB = await prisma.property.create({
    data: { organizationId: org.id, portfolioId: portfolio.id, name: "Prop B", addressLine1: "2 Main St", city: "Testville", state: "TX", postalCode: "75001" },
  });
});

beforeEach(async () => {
  await prisma.usageRecord.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
  await prisma.costRate.deleteMany({ where: { OR: [{ organizationId: { in: [org.id, otherOrg.id] } }, { organizationId: null }] } });
  await prisma.storageObject.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
});

afterAll(async () => {
  await prisma.usageRecord.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
  await prisma.costRate.deleteMany({ where: { OR: [{ organizationId: { in: [org.id, otherOrg.id] } }, { organizationId: null }] } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.organization.delete({ where: { id: otherOrg.id } });
});

describe("recordUsage", () => {
  it("records a quantity against a property", async () => {
    await recordUsage({
      organizationId: org.id,
      propertyId: propertyA.id,
      metricType: UsageMetricType.PROCESSING_JOB,
      quantity: 1,
      recordedAt: JAN,
    });
    const rows = await prisma.usageRecord.findMany({ where: { organizationId: org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].propertyId).toBe(propertyA.id);
  });

  it("refuses a negative quantity rather than letting it offset real usage", async () => {
    await recordUsage({
      organizationId: org.id,
      metricType: UsageMetricType.AI_REQUEST,
      quantity: -5,
      recordedAt: JAN,
    });
    expect(await prisma.usageRecord.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("does not throw when the row cannot be written", async () => {
    // Metering is an accounting side effect of work that already happened.
    // Failing the caller's request over it would be an absurd trade.
    await expect(
      recordUsage({
        organizationId: "does-not-exist",
        metricType: UsageMetricType.AI_REQUEST,
        quantity: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it("skips a zero quantity", async () => {
    await recordUsage({ organizationId: org.id, metricType: UsageMetricType.AI_REQUEST, quantity: 0 });
    expect(await prisma.usageRecord.count({ where: { organizationId: org.id } })).toBe(0);
  });
});

describe("resolveRate", () => {
  it("prefers an organization rate over the platform default", async () => {
    await setRate(ctxFor(org.id), {
      organizationId: null,
      metricType: UsageMetricType.AI_REQUEST,
      unitCostMicros: 1000,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    await setRate(ctxFor(org.id), {
      organizationId: org.id,
      metricType: UsageMetricType.AI_REQUEST,
      unitCostMicros: 250,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    const rate = await resolveRate(org.id, UsageMetricType.AI_REQUEST, JAN);
    expect(rate?.unitCostMicros).toBe(250);
  });

  it("falls back to the platform default for an organization with no override", async () => {
    await setRate(ctxFor(org.id), {
      organizationId: null,
      metricType: UsageMetricType.AI_REQUEST,
      unitCostMicros: 1000,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    const rate = await resolveRate(otherOrg.id, UsageMetricType.AI_REQUEST, JAN);
    expect(rate?.unitCostMicros).toBe(1000);
  });

  it("returns null when nothing covers the metric", async () => {
    expect(await resolveRate(org.id, UsageMetricType.BANDWIDTH_GB, JAN)).toBeNull();
  });

  it("does not apply a rate before it takes effect", async () => {
    await setRate(ctxFor(org.id), {
      organizationId: org.id,
      metricType: UsageMetricType.AI_REQUEST,
      unitCostMicros: 500,
      effectiveFrom: new Date("2026-02-01T00:00:00Z"),
    });
    expect(await resolveRate(org.id, UsageMetricType.AI_REQUEST, JAN)).toBeNull();
    expect((await resolveRate(org.id, UsageMetricType.AI_REQUEST, FEB))?.unitCostMicros).toBe(500);
  });

  it("uses the latest rate that has started, so a correction supersedes what it corrects", async () => {
    const ctx = ctxFor(org.id);
    await setRate(ctx, {
      organizationId: org.id,
      metricType: UsageMetricType.AI_REQUEST,
      unitCostMicros: 100,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    await setRate(ctx, {
      organizationId: org.id,
      metricType: UsageMetricType.AI_REQUEST,
      unitCostMicros: 900,
      effectiveFrom: new Date("2026-01-10T00:00:00Z"),
    });
    expect((await resolveRate(org.id, UsageMetricType.AI_REQUEST, JAN))?.unitCostMicros).toBe(900);
    // ...and the earlier rate still prices the days it actually covered.
    const early = new Date("2026-01-05T00:00:00Z");
    expect((await resolveRate(org.id, UsageMetricType.AI_REQUEST, early))?.unitCostMicros).toBe(100);
  });

  it("refuses a negative or fractional unit cost", async () => {
    const ctx = ctxFor(org.id);
    await expect(
      setRate(ctx, { organizationId: org.id, metricType: UsageMetricType.AI_REQUEST, unitCostMicros: -1, effectiveFrom: JAN }),
    ).rejects.toThrow(ApiError);
    await expect(
      setRate(ctx, { organizationId: org.id, metricType: UsageMetricType.AI_REQUEST, unitCostMicros: 1.5, effectiveFrom: JAN }),
    ).rejects.toThrow(ApiError);
  });
});

describe("summarizePropertyCogs", () => {
  async function rate(metricType: UsageMetricType, micros: number, from = new Date("2026-01-01T00:00:00Z")) {
    return setRate(ctxFor(org.id), { organizationId: org.id, metricType, unitCostMicros: micros, effectiveFrom: from });
  }

  it("attributes cost to the property that incurred it", async () => {
    await rate(UsageMetricType.PROCESSING_JOB, 2_000_000); // $2.00 per job
    await recordUsage({ organizationId: org.id, propertyId: propertyA.id, metricType: UsageMetricType.PROCESSING_JOB, quantity: 3, recordedAt: JAN });
    await recordUsage({ organizationId: org.id, propertyId: propertyB.id, metricType: UsageMetricType.PROCESSING_JOB, quantity: 1, recordedAt: JAN });

    const report = await summarizePropertyCogs(org.id, WINDOW_START, WINDOW_END);
    const a = report.properties.find((p) => p.propertyId === propertyA.id);
    const b = report.properties.find((p) => p.propertyId === propertyB.id);
    expect(a?.costMicros).toBe(6_000_000);
    expect(b?.costMicros).toBe(2_000_000);
    expect(report.totalCostMicros).toBe(8_000_000);
  });

  it("sorts properties by cost so the expensive ones are visible first", async () => {
    await rate(UsageMetricType.PROCESSING_JOB, 1_000_000);
    await recordUsage({ organizationId: org.id, propertyId: propertyA.id, metricType: UsageMetricType.PROCESSING_JOB, quantity: 1, recordedAt: JAN });
    await recordUsage({ organizationId: org.id, propertyId: propertyB.id, metricType: UsageMetricType.PROCESSING_JOB, quantity: 9, recordedAt: JAN });
    const report = await summarizePropertyCogs(org.id, WINDOW_START, WINDOW_END);
    expect(report.properties[0].propertyId).toBe(propertyB.id);
  });

  it("keeps org-level overhead OUT of every property and reports it separately", async () => {
    // This is the honesty property of the whole feature: unattributed cost
    // must not be spread across properties, because that would manufacture a
    // per-property precision that was never measured.
    await rate(UsageMetricType.AI_REQUEST, 500_000);
    await recordUsage({ organizationId: org.id, propertyId: null, metricType: UsageMetricType.AI_REQUEST, quantity: 4, recordedAt: JAN });
    await recordUsage({ organizationId: org.id, propertyId: propertyA.id, metricType: UsageMetricType.AI_REQUEST, quantity: 1, recordedAt: JAN });

    const report = await summarizePropertyCogs(org.id, WINDOW_START, WINDOW_END);
    expect(report.properties).toHaveLength(1);
    expect(report.properties[0].costMicros).toBe(500_000);
    expect(report.unattributed.costMicros).toBe(2_000_000);
    expect(report.totalCostMicros).toBe(2_500_000);
  });

  it("reports unpriced usage as unpriced, never as free", async () => {
    // No rate configured for PROCESSING_JOB at all.
    await recordUsage({ organizationId: org.id, propertyId: propertyA.id, metricType: UsageMetricType.PROCESSING_JOB, quantity: 7, recordedAt: JAN });
    const report = await summarizePropertyCogs(org.id, WINDOW_START, WINDOW_END);
    const line = report.properties[0].lines[0];
    expect(line.quantity).toBe(7);
    expect(line.costMicros).toBeNull();
    expect(line.unpriced).toBe(true);
    expect(report.hasUnpricedUsage).toBe(true);
  });

  it("flags a total as incomplete when only some usage is priced", async () => {
    await rate(UsageMetricType.AI_REQUEST, 500_000);
    await recordUsage({ organizationId: org.id, propertyId: propertyA.id, metricType: UsageMetricType.AI_REQUEST, quantity: 2, recordedAt: JAN });
    await recordUsage({ organizationId: org.id, propertyId: propertyA.id, metricType: UsageMetricType.PROCESSING_JOB, quantity: 1, recordedAt: JAN });

    const report = await summarizePropertyCogs(org.id, WINDOW_START, WINDOW_END);
    // The priced part still totals, but the report must not present it as complete.
    expect(report.totalCostMicros).toBe(1_000_000);
    expect(report.hasUnpricedUsage).toBe(true);
    expect(report.properties[0].hasUnpricedUsage).toBe(true);
  });

  it("prices each row at the rate in effect when it was recorded", async () => {
    // A period straddling a price change must be priced on both sides of it.
    await rate(UsageMetricType.AI_REQUEST, 100_000, new Date("2026-01-01T00:00:00Z"));
    await rate(UsageMetricType.AI_REQUEST, 300_000, new Date("2026-02-01T00:00:00Z"));
    await recordUsage({ organizationId: org.id, propertyId: propertyA.id, metricType: UsageMetricType.AI_REQUEST, quantity: 1, recordedAt: JAN });
    await recordUsage({ organizationId: org.id, propertyId: propertyA.id, metricType: UsageMetricType.AI_REQUEST, quantity: 1, recordedAt: FEB });

    const report = await summarizePropertyCogs(org.id, WINDOW_START, WINDOW_END);
    // 100_000 + 300_000, NOT 2 x either rate.
    expect(report.properties[0].costMicros).toBe(400_000);
  });

  it("excludes usage outside the period", async () => {
    await rate(UsageMetricType.AI_REQUEST, 100_000);
    await recordUsage({ organizationId: org.id, propertyId: propertyA.id, metricType: UsageMetricType.AI_REQUEST, quantity: 1, recordedAt: JAN });
    await recordUsage({
      organizationId: org.id, propertyId: propertyA.id, metricType: UsageMetricType.AI_REQUEST,
      quantity: 99, recordedAt: new Date("2026-06-01T00:00:00Z"),
    });
    const report = await summarizePropertyCogs(org.id, WINDOW_START, WINDOW_END);
    expect(report.properties[0].costMicros).toBe(100_000);
  });

  it("does not include another organization's usage", async () => {
    await rate(UsageMetricType.AI_REQUEST, 100_000);
    await recordUsage({ organizationId: otherOrg.id, metricType: UsageMetricType.AI_REQUEST, quantity: 1000, recordedAt: JAN });
    const report = await summarizePropertyCogs(org.id, WINDOW_START, WINDOW_END);
    expect(report.totalCostMicros).toBe(0);
    expect(report.properties).toHaveLength(0);
  });

  it("refuses a period that ends before it starts", async () => {
    await expect(summarizePropertyCogs(org.id, WINDOW_END, WINDOW_START)).rejects.toThrow(ApiError);
  });
});

describe("sampleStorageUsage", () => {
  async function seed(tier: StorageTier, bytes: number, key: string) {
    const obj = await registerStorageObject({
      organizationId: org.id,
      storageKey: key,
      kind: StorageObjectKind.DRONE_IMAGE,
      sizeBytes: bytes,
      objectCreatedAt: new Date(),
    });
    if (tier !== StorageTier.STANDARD) {
      await prisma.storageObject.update({ where: { id: obj.id }, data: { currentTier: tier } });
    }
  }

  it("accrues GB-months for the interval, not the whole balance", async () => {
    // 30 GB held for 30 days is 30 GB-months; the same bytes sampled daily
    // must accrue a thirtieth of that, or a month of daily runs would bill
    // thirty months of storage.
    await seed(StorageTier.STANDARD, 30 * 1_000_000_000, "s/one");
    await sampleStorageUsage(org.id, 1, JAN);
    const row = await prisma.usageRecord.findFirst({ where: { organizationId: org.id } });
    expect(row?.metricType).toBe(UsageMetricType.STORAGE_STANDARD_GB_MONTH);
    expect(row?.quantity).toBeCloseTo(1, 6); // 30 GB x (1/30 month)
  });

  it("meters each tier under its own metric, since the tiers are priced apart", async () => {
    await seed(StorageTier.STANDARD, 10 * 1_000_000_000, "s/hot");
    await seed(StorageTier.DEEP_ARCHIVE, 10 * 1_000_000_000, "s/cold");
    await sampleStorageUsage(org.id, 30, JAN);

    const rows = await prisma.usageRecord.findMany({ where: { organizationId: org.id } });
    const metrics = rows.map((r) => r.metricType).sort();
    expect(metrics).toEqual([
      UsageMetricType.STORAGE_DEEP_ARCHIVE_GB_MONTH,
      UsageMetricType.STORAGE_STANDARD_GB_MONTH,
    ]);
  });

  it("prices a cold gigabyte far below a hot one", async () => {
    await setRate(ctxFor(org.id), { organizationId: org.id, metricType: UsageMetricType.STORAGE_STANDARD_GB_MONTH, unitCostMicros: 23_000, effectiveFrom: WINDOW_START });
    await setRate(ctxFor(org.id), { organizationId: org.id, metricType: UsageMetricType.STORAGE_DEEP_ARCHIVE_GB_MONTH, unitCostMicros: 1_000, effectiveFrom: WINDOW_START });
    await seed(StorageTier.STANDARD, 10 * 1_000_000_000, "s/hot");
    await seed(StorageTier.DEEP_ARCHIVE, 10 * 1_000_000_000, "s/cold");
    await sampleStorageUsage(org.id, 30, JAN);

    const report = await summarizePropertyCogs(org.id, WINDOW_START, WINDOW_END);
    const hot = report.unattributed.lines.find((l) => l.metricType === UsageMetricType.STORAGE_STANDARD_GB_MONTH);
    const cold = report.unattributed.lines.find((l) => l.metricType === UsageMetricType.STORAGE_DEEP_ARCHIVE_GB_MONTH);
    expect(hot?.costMicros).toBeCloseTo(230_000, 3);
    expect(cold?.costMicros).toBeCloseTo(10_000, 3);
  });

  it("records nothing for an organization holding no objects", async () => {
    const result = await sampleStorageUsage(org.id, 1, JAN);
    expect(result.sampled).toBe(0);
    expect(await prisma.usageRecord.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("refuses a non-positive interval rather than silently metering nothing", async () => {
    await expect(sampleStorageUsage(org.id, 0, JAN)).rejects.toThrow(ApiError);
    await expect(sampleStorageUsage(org.id, -7, JAN)).rejects.toThrow(ApiError);
  });
});

/**
 * A 32-bit sizeBytes column capped a single stored object at 2.147 GB. Drone
 * point clouds and orthomosaics routinely exceed that, and on the upload
 * paths the failure was SILENT: the tiering ledger write is best-effort, so
 * the upload succeeded, the object was never registered, and it would then
 * never be tiered or costed.
 */
describe("object sizes past a 32-bit column", () => {
  const INT4_MAX = 2_147_483_647;

  it("stores an object larger than a 32-bit integer can hold", async () => {
    const bytes = 8 * 1_000_000_000; // 8 GB point cloud
    expect(bytes).toBeGreaterThan(INT4_MAX);

    await registerStorageObject({
      organizationId: org.id,
      storageKey: "big/cloud.las",
      kind: StorageObjectKind.DRONE_OUTPUT,
      sizeBytes: bytes,
      objectCreatedAt: new Date(),
    });

    const row = await prisma.storageObject.findFirst({
      where: { organizationId: org.id, storageKey: "big/cloud.las" },
    });
    expect(Number(row?.sizeBytes)).toBe(bytes);
  });

  it("costs a multi-terabyte footprint without overflowing", async () => {
    await setRate(ctxFor(org.id), {
      organizationId: org.id,
      metricType: UsageMetricType.STORAGE_STANDARD_GB_MONTH,
      unitCostMicros: 23_000,
      effectiveFrom: WINDOW_START,
    });
    await registerStorageObject({
      organizationId: org.id,
      storageKey: "big/archive.tar",
      kind: StorageObjectKind.DRONE_OUTPUT,
      sizeBytes: 5_000 * 1_000_000_000, // 5 TB
      objectCreatedAt: new Date(),
    });
    await sampleStorageUsage(org.id, 30, JAN);

    const report = await summarizePropertyCogs(org.id, WINDOW_START, WINDOW_END);
    const line = report.unattributed.lines.find(
      (l) => l.metricType === UsageMetricType.STORAGE_STANDARD_GB_MONTH,
    );
    expect(line?.quantity).toBeCloseTo(5_000, 3);
    expect(line?.costMicros).toBeCloseTo(5_000 * 23_000, 0);
  });
});
