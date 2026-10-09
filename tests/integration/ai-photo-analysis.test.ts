import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { createCaptureJob, issueCaptureJob, outstandingDeliverables, getCaptureJob } from "@/lib/capture-job-service";
import { createEvidence } from "@/lib/evidence-service";
import { getStorageProvider } from "@/lib/storage";
import { analyzeEvidencePhoto, getSitePhotoFindings, reviewAIFinding } from "@/lib/ai/photo-analysis";
import { __setAIProviderForTest } from "@/lib/ai/provider-factory";
import type { AIProvider } from "@/lib/ai/provider";
import { NullProvider } from "@/lib/ai/providers/null-provider";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * AI photo analysis: the AI suggests, a person confirms, and only the
 * confirmation moves a score. The tests that matter most here are the ones
 * proving a suggestion on its own changes nothing.
 */

const suffix = `aipa${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let vendor: { id: string };
let staff: { id: string };
let vendorUser: { id: string };
let otherVendorUser: { id: string };
let site: { id: string };
let otherSite: { id: string };
let asset: { id: string };
let assetElsewhere: { id: string };

const baseCtx = (): SessionContext => ({
  userId: staff.id,
  userName: "Staff",
  userEmail: `staff-${suffix}@example.com`,
  isPlatformAdmin: false,
  organizationId: org.id,
  organizationName: "AIPA Org",
  membershipId: "irrelevant",
  role: Role.OWNER,
  vendorId: null,
  grants: [],
  permissions: [],
  mfaRequired: false,
  mfaEnrolled: false,
  impersonation: null,
});
const staffCtx = baseCtx;
const vendorCtx = (): SessionContext => ({ ...baseCtx(), userId: vendorUser.id, role: Role.VENDOR, vendorId: vendor.id });
const otherVendorCtx = (): SessionContext => ({ ...vendorCtx(), userId: otherVendorUser.id });
const viewerCtx = (): SessionContext => ({ ...baseCtx(), role: Role.VIEWER });

/** A provider that answers with a fixed analysis and counts its calls. */
function fakeProvider(output: unknown): AIProvider & { calls: number } {
  const p = {
    name: "fake",
    calls: 0,
    supportsVision: () => true,
    supportsStructuredOutput: () => true,
    generateResponse: async () => "",
    runToolLoop: async () => ({ answer: "", toolCalls: [] }),
    analyzeImage: async () => {
      p.calls += 1;
      return { output, usage: { inputTokens: 1200, outputTokens: 150 } };
    },
  };
  return p;
}

const RUSTY_RTU = {
  imageUsable: true,
  label: "Corroded condenser coil housing",
  description: "Heavy surface rust on the housing and a dented access panel.",
  conditionScore: 58,
  severity: "HIGH",
  confidence: 0.8,
  defects: [{ label: "Surface corrosion", severity: "HIGH", location: "lower housing" }],
  recommendedAction: "Schedule HVAC contractor inspection within 30 days.",
};

async function vendorPhoto(opts: { assetId?: string; mimeType?: string; type?: "PHOTO" | "DOCUMENT" } = {}) {
  const key = `test/${suffix}/${Math.random().toString(36).slice(2)}.jpg`;
  await getStorageProvider().writeBytes(key, Buffer.from("fake-jpeg-bytes"));
  return createEvidence(vendorCtx(), {
    type: opts.type ?? "PHOTO",
    storageKey: key,
    mimeType: opts.mimeType ?? "image/jpeg",
    sizeBytes: 15,
    propertyId: site.id,
    assetId: opts.assetId ?? null,
  });
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `AIPA ${suffix}`, slug: `aipa-${suffix}` } });
  vendor = await prisma.vendor.create({ data: { organizationId: org.id, name: `Cap ${suffix}`, trade: "Capture" } });
  staff = await prisma.user.create({ data: { email: `staff-${suffix}@example.com`, passwordHash: "x", name: "Staff" } });
  vendorUser = await prisma.user.create({ data: { email: `v-${suffix}@example.com`, passwordHash: "x", name: "Vendor" } });
  otherVendorUser = await prisma.user.create({ data: { email: `v2-${suffix}@example.com`, passwordHash: "x", name: "Vendor 2" } });
  await prisma.membership.create({ data: { userId: staff.id, organizationId: org.id, role: Role.OWNER } });
  for (const u of [vendorUser, otherVendorUser]) {
    await prisma.membership.create({ data: { userId: u.id, organizationId: org.id, role: Role.VENDOR, vendorId: vendor.id } });
  }
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1 Main", city: "X", state: "TX", postalCode: "75001" },
    });
  site = await mk("site");
  otherSite = await mk("other");
  asset = await prisma.asset.create({
    data: { organizationId: org.id, propertyId: site.id, name: "RTU-01", assetType: "HVAC rooftop unit", conditionScore: 90, criticalityScore: 4 },
  });
  assetElsewhere = await prisma.asset.create({
    data: { organizationId: org.id, propertyId: otherSite.id, name: "RTU-99", assetType: "HVAC rooftop unit", conditionScore: 90 },
  });
});

beforeEach(async () => {
  await prisma.captureJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.assetConditionHistory.deleteMany({ where: { assetId: asset.id } });
  await prisma.asset.update({ where: { id: asset.id }, data: { conditionScore: 90 } });
  const job = await createCaptureJob(staffCtx(), {
    title: `AI sweep ${suffix}`,
    vendorId: vendor.id,
    propertyIds: [site.id],
    deliverables: ["PHOTOS", "CONDITION_SCORES"],
  });
  await issueCaptureJob(staffCtx(), job.id);
});

afterEach(() => __setAIProviderForTest(null));

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: { in: [staff.id, vendorUser.id, otherVendorUser.id] } } });
});

describe("the AI suggests", () => {
  it("records a suggestion and changes no score", async () => {
    const provider = fakeProvider(RUSTY_RTU);
    __setAIProviderForTest(provider);
    const photo = await vendorPhoto({ assetId: asset.id });

    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);

    expect(finding.status).toBe("SUGGESTED");
    expect(finding.suggestedScore).toBe(58);
    expect(finding.suggestedSeverity).toBe("HIGH");
    expect(finding.assetId).toBe(asset.id);
    // The point of the feature: nothing moves until a person confirms.
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).conditionScore).toBe(90);
    expect(await prisma.assetConditionHistory.count({ where: { assetId: asset.id } })).toBe(0);
    // And a suggestion does not satisfy the job's condition-scores deliverable.
    const job = (await prisma.captureJob.findFirstOrThrow({ where: { organizationId: org.id }, include: { sites: true } }));
    expect((await outstandingDeliverables(job.sites[0].id)).missing).toContain("CONDITION_SCORES");
  });

  it("meters the call", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    await analyzeEvidencePhoto(vendorCtx(), photo.id);
    const rows = await prisma.usageRecord.findMany({ where: { organizationId: org.id, source: "photo-analysis" } });
    const byType = Object.fromEntries(rows.map((r) => [r.metricType, Number(r.quantity)]));
    expect(byType.AI_REQUEST).toBeGreaterThanOrEqual(1);
    expect(byType.AI_INPUT_TOKENS).toBeGreaterThanOrEqual(1200);
  });

  it("does not pay twice for the same photo and asset while a suggestion is open", async () => {
    const provider = fakeProvider(RUSTY_RTU);
    __setAIProviderForTest(provider);
    const photo = await vendorPhoto({ assetId: asset.id });
    const a = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    const b = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    expect(b.id).toBe(a.id);
    expect(provider.calls).toBe(1);
  });

  it("stores no score when the photo is unusable", async () => {
    __setAIProviderForTest(fakeProvider({ ...RUSTY_RTU, imageUsable: false, label: "Too dark", conditionScore: 0, confidence: 0 }));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    expect(finding.suggestedScore).toBeNull();
    // Confirming needs a score from the person, since the AI gave none.
    await expect(reviewAIFinding(vendorCtx(), finding.id, { decision: "confirm" })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an answer in the wrong shape rather than storing it", async () => {
    __setAIProviderForTest(fakeProvider({ ...RUSTY_RTU, conditionScore: 140 }));
    const photo = await vendorPhoto({ assetId: asset.id });
    await expect(analyzeEvidencePhoto(vendorCtx(), photo.id)).rejects.toMatchObject({ status: 502 });
    expect(await prisma.aIFinding.count({ where: { evidenceId: photo.id } })).toBe(0);
  });

  it("says plainly when no AI provider is configured", async () => {
    __setAIProviderForTest(new NullProvider("none"));
    const photo = await vendorPhoto({ assetId: asset.id });
    await expect(analyzeEvidencePhoto(vendorCtx(), photo.id)).rejects.toMatchObject({ status: 503 });
  });

  it("refuses an asset on another property, and a non-image file", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto();
    await expect(analyzeEvidencePhoto(vendorCtx(), photo.id, { assetId: assetElsewhere.id })).rejects.toMatchObject({ status: 400 });
    await expect(analyzeEvidencePhoto(vendorCtx(), photo.id)).rejects.toMatchObject({ status: 400 });
    const pdf = await vendorPhoto({ assetId: asset.id, mimeType: "application/pdf", type: "DOCUMENT" });
    await expect(analyzeEvidencePhoto(vendorCtx(), pdf.id)).rejects.toMatchObject({ status: 400 });
  });

  it("lets a vendor analyse only photos they took", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    await expect(analyzeEvidencePhoto(otherVendorCtx(), photo.id)).rejects.toMatchObject({ status: 404 });
    expect(await getSitePhotoFindings(otherVendorCtx(), photo.captureJobSiteId!)).toHaveLength(0);
    expect(await getSitePhotoFindings(vendorCtx(), photo.captureJobSiteId!)).toHaveLength(1);
  });
});

describe("a person confirms", () => {
  it("applies the suggested score as AI-verified, with the photo as evidence", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);

    const reviewed = await reviewAIFinding(vendorCtx(), finding.id, { decision: "confirm" });

    expect(reviewed.status).toBe("HUMAN_VERIFIED");
    expect(reviewed.confirmedScore).toBe(58);
    const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.conditionScore).toBe(58);
    expect(after.validationStatus).toBe("AI_HUMAN_VERIFIED");
    const history = await prisma.assetConditionHistory.findFirstOrThrow({ where: { assetId: asset.id } });
    expect(history.source).toBe("AI_SUGGESTED");
    expect(history.evidenceId).toBe(photo.id);
    expect(history.changedByUserId).toBe(vendorUser.id);
    // The confirmed rating is the vendor's condition-scores deliverable.
    const job = await getCaptureJob(staffCtx(), (await prisma.captureJob.findFirstOrThrow({ where: { organizationId: org.id } })).id);
    expect((await outstandingDeliverables(job.sites[0].id)).missing).not.toContain("CONDITION_SCORES");
  });

  it("applies the reviewer's own score when they disagree, and records both", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    await reviewAIFinding(vendorCtx(), finding.id, { decision: "confirm", score: 70, note: "Rust is cosmetic" });
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).conditionScore).toBe(70);
    const history = await prisma.assetConditionHistory.findFirstOrThrow({ where: { assetId: asset.id } });
    expect(history.reason).toContain("AI suggested 58, reviewer set 70");
  });

  it("changes nothing on rejection", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    const reviewed = await reviewAIFinding(vendorCtx(), finding.id, { decision: "reject", note: "Wrong unit" });
    expect(reviewed.status).toBe("REJECTED");
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).conditionScore).toBe(90);
    expect(await prisma.assetConditionHistory.count({ where: { assetId: asset.id } })).toBe(0);
  });

  it("applies a finding once, however many times it is confirmed", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    const results = await Promise.allSettled([
      reviewAIFinding(vendorCtx(), finding.id, { decision: "confirm" }),
      reviewAIFinding(staffCtx(), finding.id, { decision: "confirm" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.assetConditionHistory.count({ where: { assetId: asset.id } })).toBe(1);
  });

  it("lets staff confirm a vendor's finding, but never another vendor user", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    await expect(reviewAIFinding(otherVendorCtx(), finding.id, { decision: "confirm" })).rejects.toMatchObject({ status: 404 });
    const reviewed = await reviewAIFinding(staffCtx(), finding.id, { decision: "confirm" });
    expect(reviewed.reviewedById).toBe(staff.id);
  });

  it("is invisible to another organization", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    const outsider = { ...staffCtx(), organizationId: "some-other-org" };
    await expect(reviewAIFinding(outsider, finding.id, { decision: "confirm" })).rejects.toMatchObject({ status: 404 });
  });

  it("is never available to the read-only role, which sees every property", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    await expect(analyzeEvidencePhoto(viewerCtx(), photo.id)).rejects.toMatchObject({ status: 403 });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    await expect(reviewAIFinding(viewerCtx(), finding.id, { decision: "confirm" })).rejects.toMatchObject({ status: 403 });
    expect(await getSitePhotoFindings(viewerCtx(), photo.captureJobSiteId!)).toHaveLength(0);
  });
});
