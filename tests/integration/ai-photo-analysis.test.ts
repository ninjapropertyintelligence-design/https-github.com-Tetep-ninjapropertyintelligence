import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { createCaptureJob, issueCaptureJob, outstandingDeliverables, getCaptureJob } from "@/lib/capture-job-service";
import { createEvidence } from "@/lib/evidence-service";
import { getStorageProvider } from "@/lib/storage";
import { analyzeEvidencePhoto, getSitePhotoFindings, planConfirmation, reviewAIFinding } from "@/lib/ai/photo-analysis";
import { listEffectiveDefectRules, resolveDefectRule, upsertDefectRule, validateDefectRule } from "@/lib/defect-rules";
import { getLatestHealthSnapshot } from "@/lib/scoring";
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
  defectClass: "hvac_corrosion",
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
  await prisma.issue.deleteMany({ where: { organizationId: org.id } });
  await prisma.defectRule.deleteMany({ where: { organizationId: org.id } });
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
    expect(finding.defectClass).toBe("hvac_corrosion");
    expect(finding.suggestedScore).toBe(58);
    expect(finding.suggestedSeverity).toBe("HIGH");
    expect(finding.assetId).toBe(asset.id);
    // The point of the feature: nothing moves until a person confirms.
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).conditionScore).toBe(90);
    expect(await prisma.assetConditionHistory.count({ where: { assetId: asset.id } })).toBe(0);
    // No Issue either: unverified detections never reach the table the
    // scoring engine reads.
    expect(await prisma.issue.count({ where: { organizationId: org.id } })).toBe(0);
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

  it("keeps no class the rulebook does not know", async () => {
    __setAIProviderForTest(fakeProvider({ ...RUSTY_RTU, defectClass: "alien_damage" }));
    const photo = await vendorPhoto({ assetId: asset.id });
    expect((await analyzeEvidencePhoto(vendorCtx(), photo.id)).defectClass).toBeNull();
  });

  it("offers the model exactly the organization's rulebook classes", async () => {
    await upsertDefectRule(org.id, staff.id, {
      defectClass: "signage_damage",
      category: "ExteriorParking",
      defaultSeverity: "LOW",
      conditionHit: 5,
      repairCostCents: 50_000,
    });
    let offered: string[] = [];
    const provider = fakeProvider(RUSTY_RTU);
    const inner = provider.analyzeImage;
    provider.analyzeImage = async (params: Parameters<AIProvider["analyzeImage"]>[0]) => {
      offered = (params.schema.properties.defectClass as { enum: string[] }).enum;
      return inner(params);
    };
    __setAIProviderForTest(provider);
    const photo = await vendorPhoto({ assetId: asset.id });
    await analyzeEvidencePhoto(vendorCtx(), photo.id);
    expect(offered).toContain("roof_shingle_damage");
    expect(offered).toContain("signage_damage");
    expect(offered).toContain("none");
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
  it("applies the defect rule: condition hit, issue, cost — all in one go", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);

    const reviewed = await reviewAIFinding(vendorCtx(), finding.id, { decision: "confirm" });

    // Platform default for hvac_corrosion: -15 condition, MEDIUM, and NO
    // repair estimate — the platform invents none. The AI suggested 58; the
    // rule, not the model, decides the number.
    expect(reviewed.status).toBe("HUMAN_VERIFIED");
    expect(reviewed.confirmedScore).toBe(75);
    const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.conditionScore).toBe(75);
    expect(after.validationStatus).toBe("AI_HUMAN_VERIFIED");

    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: reviewed.issueId! } });
    expect(issue.severity).toBe("MEDIUM");
    expect(issue.estimatedCost).toBeNull();
    expect(issue.description).toContain("no repair estimate set");
    expect(issue.source).toBe("AI_SUGGESTED");
    expect(issue.assetId).toBe(asset.id);
    expect(issue.propertyId).toBe(site.id);
    expect(issue.title).toBe("Hvac corrosion: RTU-01");
    // The photo is the issue's evidence.
    expect((await prisma.evidence.findUniqueOrThrow({ where: { id: photo.id } })).issueId).toBe(issue.id);

    const history = await prisma.assetConditionHistory.findFirstOrThrow({ where: { assetId: asset.id } });
    expect(history.source).toBe("AI_SUGGESTED");
    expect(history.evidenceId).toBe(photo.id);
    expect(history.changedByUserId).toBe(vendorUser.id);
    expect(history.reason).toContain("rule took 15 off 90");

    // With no estimate, the issue adds nothing to capital exposure.
    const snapshot = await getLatestHealthSnapshot(site.id);
    expect(snapshot!.capitalExposure12mo + snapshot!.capitalExposure24mo + snapshot!.capitalExposure36mo).toBe(0);

    // The confirmed rating is the vendor's condition-scores deliverable.
    const job = await getCaptureJob(staffCtx(), (await prisma.captureJob.findFirstOrThrow({ where: { organizationId: org.id } })).id);
    expect((await outstandingDeliverables(job.sites[0].id)).missing).not.toContain("CONDITION_SCORES");
  });

  it("uses the organization's own rule over the platform default", async () => {
    await upsertDefectRule(org.id, staff.id, {
      defectClass: "hvac_corrosion",
      category: "HVAC",
      defaultSeverity: "HIGH",
      conditionHit: 40,
      repairCostCents: 900_000,
    });
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    const reviewed = await reviewAIFinding(vendorCtx(), finding.id, { decision: "confirm" });
    expect(reviewed.confirmedScore).toBe(50);
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: reviewed.issueId! } });
    expect(issue.severity).toBe("HIGH");
    expect(issue.estimatedCost).toBe(900_000);
    // The organization's own price is what reaches capital exposure (HIGH
    // with no due date lands in the 24-month bucket).
    const snapshot = await getLatestHealthSnapshot(site.id);
    expect(snapshot!.capitalExposure24mo).toBe(900_000);
  });

  it("lets the reviewer's score win, but keeps the rule's severity and cost", async () => {
    await upsertDefectRule(org.id, staff.id, {
      defectClass: "hvac_corrosion",
      category: "HVAC",
      defaultSeverity: "MEDIUM",
      conditionHit: 15,
      repairCostCents: 400_000,
    });
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    const reviewed = await reviewAIFinding(vendorCtx(), finding.id, { decision: "confirm", score: 82, note: "Rust is cosmetic" });
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).conditionScore).toBe(82);
    const history = await prisma.assetConditionHistory.findFirstOrThrow({ where: { assetId: asset.id } });
    expect(history.reason).toContain("reviewer set 82 (AI suggested 58)");
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: reviewed.issueId! } })).estimatedCost).toBe(400_000);
  });

  it("lets the reviewer set severity and cost by hand, and records that they did", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    const reviewed = await reviewAIFinding(vendorCtx(), finding.id, {
      decision: "confirm",
      severity: "CRITICAL",
      repairCostCents: 1_250_000,
    });
    // The rule still sets the score (90 - 15); the person set the rest.
    expect(reviewed.confirmedScore).toBe(75);
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: reviewed.issueId! } });
    expect(issue.severity).toBe("CRITICAL");
    expect(issue.estimatedCost).toBe(1_250_000);
    expect(issue.description).toContain("severity set by reviewer to critical");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: finding.id, action: "ai_finding.confirmed" } });
    expect((audit.metadata as { overridden: unknown }).overridden).toEqual({ severity: true, cost: true });
  });

  it("with no rule, accepts the AI's score and invents no cost", async () => {
    __setAIProviderForTest(fakeProvider({ ...RUSTY_RTU, defectClass: "none" }));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    const reviewed = await reviewAIFinding(vendorCtx(), finding.id, { decision: "confirm" });
    expect(reviewed.confirmedScore).toBe(58);
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: reviewed.issueId! } });
    expect(issue.estimatedCost).toBeNull();
    expect(issue.severity).toBe("HIGH"); // the AI's severity, since no rule gives one
    expect(issue.title).toBe(RUSTY_RTU.label);
  });

  it("commits nothing when any part of the confirmation fails", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);

    // Make the LAST write of the transaction — the condition history row —
    // fail inside the database. By then the finding has been claimed and the
    // Issue created; both must roll back with it.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_history() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced failure for rollback test'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_history BEFORE INSERT ON "AssetConditionHistory"
       FOR EACH ROW WHEN (NEW."assetId" = '${asset.id}') EXECUTE FUNCTION test_fail_history()`,
    );
    try {
      await expect(reviewAIFinding(vendorCtx(), finding.id, { decision: "confirm" })).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_fail_history ON "AssetConditionHistory"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_fail_history()`);
    }

    expect((await prisma.aIFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("SUGGESTED");
    expect(await prisma.issue.count({ where: { organizationId: org.id } })).toBe(0);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).conditionScore).toBe(90);
    // And it can still be confirmed once the problem is gone.
    expect((await reviewAIFinding(vendorCtx(), finding.id, { decision: "confirm" })).status).toBe("HUMAN_VERIFIED");
  });

  it("changes nothing on rejection", async () => {
    __setAIProviderForTest(fakeProvider(RUSTY_RTU));
    const photo = await vendorPhoto({ assetId: asset.id });
    const finding = await analyzeEvidencePhoto(vendorCtx(), photo.id);
    const reviewed = await reviewAIFinding(vendorCtx(), finding.id, { decision: "reject", note: "Wrong unit" });
    expect(reviewed.status).toBe("REJECTED");
    expect(reviewed.issueId).toBeNull();
    expect(await prisma.issue.count({ where: { organizationId: org.id } })).toBe(0);
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
    expect(await prisma.issue.count({ where: { organizationId: org.id } })).toBe(1);
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

describe("the rulebook", () => {
  it("ships with no invented repair costs", async () => {
    // Every platform default leaves the estimate to the organization. A
    // plausible figure in code would reach capital exposure looking real.
    for (const rule of await listEffectiveDefectRules(org.id)) {
      if (rule.source === "platform") expect(rule.repairCostCents, rule.defectClass).toBeNull();
    }
  });

  it("lets an organization clear an estimate again", async () => {
    await upsertDefectRule(org.id, staff.id, { defectClass: "facade_crack", category: "ExteriorParking", defaultSeverity: "HIGH", conditionHit: 15, repairCostCents: 600_000 });
    await upsertDefectRule(org.id, staff.id, { defectClass: "facade_crack", category: "ExteriorParking", defaultSeverity: "HIGH", conditionHit: 15, repairCostCents: null });
    expect((await resolveDefectRule(org.id, "facade_crack"))!).toMatchObject({ source: "organization", repairCostCents: null });
  });

  it("merges the organization's overrides and own classes over the platform defaults", async () => {
    await upsertDefectRule(org.id, staff.id, {
      defectClass: "roof_shingle_damage",
      category: "Roof",
      defaultSeverity: "CRITICAL",
      conditionHit: 30,
      repairCostCents: 2_000_000,
    });
    const rules = await listEffectiveDefectRules(org.id);
    const shingle = rules.find((r) => r.defectClass === "roof_shingle_damage")!;
    expect(shingle).toMatchObject({ source: "organization", conditionHit: 30 });
    expect(rules.find((r) => r.defectClass === "facade_crack")!.source).toBe("platform");
    expect(await resolveDefectRule(org.id, "no_such_class")).toBeNull();
    expect(await resolveDefectRule(org.id, null)).toBeNull();
  });

  it("refuses a rule outside the scoring categories or with impossible numbers", () => {
    const ok = { defectClass: "x_damage", category: "Roof" as const, defaultSeverity: "LOW" as const, conditionHit: 5, repairCostCents: 100 };
    expect(() => validateDefectRule(ok)).not.toThrow();
    expect(() => validateDefectRule({ ...ok, repairCostCents: null })).not.toThrow();
    expect(() => validateDefectRule({ ...ok, category: "Pavement" as never })).toThrow(/Category/);
    expect(() => validateDefectRule({ ...ok, category: "Issues" as never })).toThrow(/Category/);
    expect(() => validateDefectRule({ ...ok, conditionHit: 150 })).toThrow(/Condition hit/);
    expect(() => validateDefectRule({ ...ok, repairCostCents: -1 })).toThrow(/Repair cost/);
    expect(() => validateDefectRule({ ...ok, defectClass: "Roof Damage!" })).toThrow(/snake_case/);
  });
});

describe("planConfirmation", () => {
  const rule = { defectClass: "roof_shingle_damage", category: "Roof" as const, defaultSeverity: "HIGH" as const, conditionHit: 25, repairCostCents: 1_500_000, source: "platform" as const };
  const base = { reviewerScore: null, currentScore: 85, suggestedScore: 40, suggestedSeverity: "CRITICAL" as const, rule };

  it("takes the rule's hit off the current score, never below zero", () => {
    expect(planConfirmation(base)).toMatchObject({ newScore: 60, basis: "rule", severity: "HIGH", estimatedCostCents: 1_500_000 });
    expect(planConfirmation({ ...base, currentScore: 10 }).newScore).toBe(0);
  });

  it("puts the reviewer's severity and cost ahead of the rule's", () => {
    expect(planConfirmation({ ...base, reviewerSeverity: "LOW", reviewerCostCents: 0 })).toMatchObject({
      newScore: 60,
      severity: "LOW",
      estimatedCostCents: 0,
      overridden: { severity: true, cost: true },
    });
  });

  it("is the same answer every time for the same inputs", () => {
    expect(planConfirmation(base)).toEqual(planConfirmation(base));
  });

  it("needs a score from the reviewer when the rule has nothing to subtract from", () => {
    expect(() => planConfirmation({ ...base, currentScore: null })).toThrow(/no condition score/);
    expect(planConfirmation({ ...base, currentScore: null, reviewerScore: 70 }).newScore).toBe(70);
  });
});
