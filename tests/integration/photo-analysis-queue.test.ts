import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { createCaptureJob, issueCaptureJob } from "@/lib/capture-job-service";
import { createEvidence, createEvidenceBatch } from "@/lib/evidence-service";
import { getStorageProvider } from "@/lib/storage";
import { enqueueAutoAnalysis, MAX_ATTEMPTS, processPhotoAnalysisJobs, STALE_RUNNING_MS } from "@/lib/ai/photo-analysis-queue";
import { getSitePhotoFindings } from "@/lib/ai/photo-analysis";
import { __setAIProviderForTest } from "@/lib/ai/provider-factory";
import { NullProvider } from "@/lib/ai/providers/null-provider";
import type { AIProvider } from "@/lib/ai/provider";
import type { SessionContext } from "@/lib/tenant-scope";
import { GET as cronGet } from "@/app/api/v1/cron/photo-analysis/route";

/**
 * Automatic analysis on upload. What matters: the right photos are queued
 * and only those, each photo is analysed (and billed) once however the runs
 * overlap, failures are retried only when retrying could help, and the
 * result is still only a suggestion.
 */

const suffix = `paq${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let vendor: { id: string };
let staff: { id: string };
let vendorUser: { id: string };
let site: { id: string };
let otherSite: { id: string };
let asset: { id: string };
let assetElsewhere: { id: string };

const staffCtx = (): SessionContext => ({
  userId: staff.id,
  userName: "Staff",
  userEmail: `staff-${suffix}@example.com`,
  isPlatformAdmin: false,
  organizationId: org.id,
  organizationName: "PAQ Org",
  membershipId: "irrelevant",
  role: Role.OWNER,
  vendorId: null,
  grants: [],
  permissions: [],
  mfaRequired: false,
  mfaEnrolled: false,
  impersonation: null,
});
const vendorCtx = (): SessionContext => ({ ...staffCtx(), userId: vendorUser.id, role: Role.VENDOR, vendorId: vendor.id });

const ANALYSIS = {
  imageUsable: true,
  defectClass: "hvac_corrosion",
  label: "Corroded housing",
  description: "Surface rust on the housing.",
  conditionScore: 60,
  severity: "MEDIUM",
  confidence: 0.8,
  defects: [],
  recommendedAction: "Inspect.",
};

function provider(behaviour: "ok" | "fail" = "ok"): AIProvider & { calls: number } {
  const p = {
    name: "fake",
    calls: 0,
    supportsVision: () => true,
    supportsStructuredOutput: () => true,
    generateResponse: async () => "",
    runToolLoop: async () => ({ answer: "", toolCalls: [] }),
    analyzeImage: async () => {
      p.calls += 1;
      // A slow answer, so overlapping runs really do overlap.
      await new Promise((r) => setTimeout(r, 30));
      if (behaviour === "fail") throw new Error("provider exploded");
      return { output: ANALYSIS };
    },
  };
  return p;
}

async function storedPhoto(): Promise<string> {
  const key = `test/${suffix}/${Math.random().toString(36).slice(2)}.jpg`;
  await getStorageProvider().writeBytes(key, Buffer.from("fake-jpeg-bytes"));
  return key;
}

/** A vendor upload through the real batch path, as the upload panel makes it. */
async function vendorUpload(items: Array<Partial<{ assetId: string; type: "PHOTO" | "IMAGE_360"; mimeType: string; sizeBytes: number; propertyId: string }>>) {
  const batch = await Promise.all(
    items.map(async (i) => ({
      type: i.type ?? ("PHOTO" as const),
      storageKey: await storedPhoto(),
      mimeType: i.mimeType ?? "image/jpeg",
      sizeBytes: i.sizeBytes ?? 15,
      propertyId: i.propertyId ?? site.id,
      assetId: i.assetId ?? null,
    })),
  );
  return createEvidenceBatch(vendorCtx(), batch);
}

beforeAll(async () => {
  await prisma.featureFlag.upsert({
    where: { key: "image_360" },
    create: { key: "image_360", description: "image_360 (test)", defaultEnabled: true },
    update: {},
  });
  org = await prisma.organization.create({ data: { name: `PAQ ${suffix}`, slug: `paq-${suffix}` } });
  vendor = await prisma.vendor.create({ data: { organizationId: org.id, name: `Cap ${suffix}`, trade: "Capture" } });
  staff = await prisma.user.create({ data: { email: `staff-${suffix}@example.com`, passwordHash: "x", name: "Staff" } });
  vendorUser = await prisma.user.create({ data: { email: `v-${suffix}@example.com`, passwordHash: "x", name: "Vendor" } });
  await prisma.membership.create({ data: { userId: staff.id, organizationId: org.id, role: Role.OWNER } });
  await prisma.membership.create({ data: { userId: vendorUser.id, organizationId: org.id, role: Role.VENDOR, vendorId: vendor.id } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1 Main", city: "X", state: "TX", postalCode: "75001" },
    });
  site = await mk("site");
  otherSite = await mk("other");
  asset = await prisma.asset.create({
    data: { organizationId: org.id, propertyId: site.id, name: "RTU-01", assetType: "HVAC rooftop unit", conditionScore: 90 },
  });
  assetElsewhere = await prisma.asset.create({
    data: { organizationId: org.id, propertyId: otherSite.id, name: "RTU-99", assetType: "HVAC rooftop unit", conditionScore: 90 },
  });
});

beforeEach(async () => {
  await prisma.captureJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.evidence.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.update({ where: { id: org.id }, data: { autoAnalyzePhotos: true } });
  const job = await createCaptureJob(staffCtx(), {
    title: `Sweep ${suffix}`,
    vendorId: vendor.id,
    propertyIds: [site.id, otherSite.id],
    deliverables: ["PHOTOS", "CONDITION_SCORES"],
  });
  await issueCaptureJob(staffCtx(), job.id);
});

afterEach(() => __setAIProviderForTest(null));

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: { in: [staff.id, vendorUser.id] } } });
});

describe("what gets queued", () => {
  it("queues a vendor's capture photo that names an asset, and analysing it changes no score", async () => {
    const p = provider();
    __setAIProviderForTest(p);
    const { ids } = await vendorUpload([{ assetId: asset.id }]);

    const jobIds = await enqueueAutoAnalysis(vendorCtx(), ids);
    expect(jobIds).toHaveLength(1);
    const result = await processPhotoAnalysisJobs({ jobIds });

    expect(result.done).toBe(1);
    const job = await prisma.photoAnalysisJob.findUniqueOrThrow({ where: { id: jobIds[0] } });
    expect(job.status).toBe("DONE");
    const finding = await prisma.aIFinding.findUniqueOrThrow({ where: { id: job.findingId! } });
    expect(finding).toMatchObject({ status: "SUGGESTED", evidenceId: ids[0], assetId: asset.id, requestedById: vendorUser.id });
    // Still only a suggestion: nothing moves until a person confirms.
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).conditionScore).toBe(90);
    expect(await prisma.issue.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("queues nothing the AI could not rate, or that is not a vendor's capture", async () => {
    __setAIProviderForTest(provider());
    const noAsset = await vendorUpload([{}]);
    const panorama = await vendorUpload([{ type: "IMAGE_360", assetId: asset.id }]);
    const tooBig = await vendorUpload([{ assetId: asset.id, sizeBytes: 6 * 1024 * 1024 }]);
    const notImage = await vendorUpload([{ assetId: asset.id, mimeType: "application/pdf" }]);
    for (const { ids } of [noAsset, panorama, tooBig, notImage]) {
      expect(await enqueueAutoAnalysis(vendorCtx(), ids)).toEqual([]);
    }

    // Staff uploads are the organization's own and are not held for review.
    const own = await createEvidence(staffCtx(), {
      type: "PHOTO",
      storageKey: await storedPhoto(),
      mimeType: "image/jpeg",
      propertyId: site.id,
      assetId: asset.id,
    });
    expect(await enqueueAutoAnalysis(staffCtx(), [own.id])).toEqual([]);
  });

  it("queues nothing when the organization has switched it off", async () => {
    await prisma.organization.update({ where: { id: org.id }, data: { autoAnalyzePhotos: false } });
    const { ids } = await vendorUpload([{ assetId: asset.id }]);
    expect(await enqueueAutoAnalysis(vendorCtx(), ids)).toEqual([]);
  });

  it("queues each photo once, however often the upload is repeated", async () => {
    const { ids } = await vendorUpload([{ assetId: asset.id }]);
    await enqueueAutoAnalysis(vendorCtx(), ids);
    await enqueueAutoAnalysis(vendorCtx(), ids);
    expect(await prisma.photoAnalysisJob.count({ where: { evidenceId: ids[0] } })).toBe(1);
  });

  it("refuses an upload naming an asset on another property", async () => {
    // Automatic analysis rates the named asset, so a wrong link would put one
    // building's damage on another building's equipment.
    await expect(vendorUpload([{ assetId: assetElsewhere.id }])).rejects.toMatchObject({ status: 400 });
    await expect(
      createEvidence(vendorCtx(), { type: "PHOTO", storageKey: await storedPhoto(), propertyId: site.id, assetId: assetElsewhere.id }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("processing", () => {
  it("retries a provider failure, then gives up after the last attempt", async () => {
    const p = provider("fail");
    __setAIProviderForTest(p);
    const { ids } = await vendorUpload([{ assetId: asset.id }]);
    const [jobId] = await enqueueAutoAnalysis(vendorCtx(), ids);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await processPhotoAnalysisJobs({ jobIds: [jobId] });
      const job = await prisma.photoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(job.attempts).toBe(attempt);
      expect(job.status).toBe(attempt < MAX_ATTEMPTS ? "QUEUED" : "FAILED");
    }
    // Nothing more is spent on it.
    await processPhotoAnalysisJobs();
    expect(p.calls).toBe(MAX_ATTEMPTS);
  });

  it("does not retry what cannot succeed: no AI provider configured", async () => {
    __setAIProviderForTest(new NullProvider("none"));
    const { ids } = await vendorUpload([{ assetId: asset.id }]);
    const [jobId] = await enqueueAutoAnalysis(vendorCtx(), ids);
    const result = await processPhotoAnalysisJobs({ jobIds: [jobId] });
    expect(result.skipped).toBe(1);
    const job = await prisma.photoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "SKIPPED", attempts: 1 });
    expect(job.lastError).toMatch(/not configured/);
  });

  it("analyses (and bills) a photo once when the upload run and a sweep overlap", async () => {
    const p = provider();
    __setAIProviderForTest(p);
    const { ids } = await vendorUpload([{ assetId: asset.id }, { assetId: asset.id }]);
    const jobIds = await enqueueAutoAnalysis(vendorCtx(), ids);
    await Promise.all([processPhotoAnalysisJobs({ jobIds }), processPhotoAnalysisJobs(), processPhotoAnalysisJobs()]);
    expect(p.calls).toBe(2);
    expect(await prisma.aIFinding.count({ where: { evidenceId: { in: ids } } })).toBe(2);
  });

  it("stops claiming work when its time is up, leaving the rest for the sweep", async () => {
    __setAIProviderForTest(provider());
    const { ids } = await vendorUpload([{ assetId: asset.id }, { assetId: asset.id }, { assetId: asset.id }]);
    const jobIds = await enqueueAutoAnalysis(vendorCtx(), ids);
    const result = await processPhotoAnalysisJobs({ jobIds, timeBudgetMs: 0 });
    expect(result.remaining).toBeGreaterThan(0);
    expect(await prisma.photoAnalysisJob.count({ where: { id: { in: jobIds }, status: "QUEUED" } })).toBe(result.remaining);
    // The sweep finishes them.
    await processPhotoAnalysisJobs();
    expect(await prisma.photoAnalysisJob.count({ where: { id: { in: jobIds }, status: "DONE" } })).toBe(3);
  });

  it("takes back a job abandoned mid-run, but not one still running", async () => {
    __setAIProviderForTest(provider());
    const { ids } = await vendorUpload([{ assetId: asset.id }, { assetId: asset.id }]);
    const [stale, live] = await enqueueAutoAnalysis(vendorCtx(), ids);
    await prisma.photoAnalysisJob.update({
      where: { id: stale },
      data: { status: "RUNNING", attempts: 1, startedAt: new Date(Date.now() - STALE_RUNNING_MS - 1000) },
    });
    await prisma.photoAnalysisJob.update({ where: { id: live }, data: { status: "RUNNING", attempts: 1, startedAt: new Date() } });

    await processPhotoAnalysisJobs();

    expect((await prisma.photoAnalysisJob.findUniqueOrThrow({ where: { id: stale } })).status).toBe("DONE");
    expect((await prisma.photoAnalysisJob.findUniqueOrThrow({ where: { id: live } })).status).toBe("RUNNING");
  });

  it("shows the review panel each photo's analysis state", async () => {
    __setAIProviderForTest(new NullProvider("none"));
    const { ids } = await vendorUpload([{ assetId: asset.id }]);
    const [jobId] = await enqueueAutoAnalysis(vendorCtx(), ids);
    const siteId = (await prisma.evidence.findUniqueOrThrow({ where: { id: ids[0] } })).captureJobSiteId!;
    expect((await getSitePhotoFindings(vendorCtx(), siteId))[0].analysisJob).toMatchObject({ status: "QUEUED" });
    await processPhotoAnalysisJobs({ jobIds: [jobId] });
    expect((await getSitePhotoFindings(vendorCtx(), siteId))[0].analysisJob).toMatchObject({ status: "SKIPPED" });
  });
});

describe("the cron route", () => {
  const withSecret = async (value: string | undefined, fn: () => Promise<void>) => {
    const before = process.env.CRON_SECRET;
    try {
      if (value === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = value;
      await fn();
    } finally {
      if (before === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = before;
    }
  };
  const call = (auth?: string) =>
    cronGet(new Request("http://x/api/v1/cron/photo-analysis", auth ? { headers: { authorization: auth } } : undefined));

  it("is closed without CRON_SECRET, and rejects a wrong one", async () => {
    await withSecret(undefined, async () => {
      expect((await call("Bearer anything")).status).toBe(401);
    });
    await withSecret("s3cret", async () => {
      expect((await call()).status).toBe(401);
      expect((await call("Bearer nope")).status).toBe(401);
    });
  });

  it("works through the queue with the right secret", async () => {
    __setAIProviderForTest(provider());
    const { ids } = await vendorUpload([{ assetId: asset.id }]);
    const [jobId] = await enqueueAutoAnalysis(vendorCtx(), ids);
    await withSecret("s3cret", async () => {
      const res = await call("Bearer s3cret");
      expect(res.status).toBe(200);
      expect((await res.json()).data.done).toBeGreaterThanOrEqual(1);
    });
    expect((await prisma.photoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("DONE");
  });
});
