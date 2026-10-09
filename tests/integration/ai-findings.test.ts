import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import {
  confirmFinding,
  listFindings,
  normalizeDefectClass,
  recordFindings,
  rejectFinding,
  saveDefectRule,
} from "@/lib/ai-finding-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * AI findings with a person in the loop. The promises being held: a finding
 * changes nothing until confirmed; the organization's rule only suggests and
 * the inspector's values win; no number is invented when neither gives one;
 * a finding becomes at most one issue; and nobody reaches another
 * organization's or another building's findings.
 */

const suffix = `af${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let property: { id: string };
let otherProperty: { id: string };
let roof: { id: string };
let otherAsset: { id: string };
let owner: { id: string };
let photo: { id: string };

function ctx(role: Role, extra: Partial<SessionContext> = {}): SessionContext {
  return {
    userId: owner.id,
    userName: "Inspector",
    userEmail: "i@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "AF Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
    ...extra,
  };
}
const asOwner = () => ctx(Role.OWNER);
const asInspectorElsewhere = () =>
  ctx(Role.INSPECTOR, { grants: [{ scopeType: "PROPERTY", propertyId: otherProperty.id, portfolioId: null, regionId: null }] });

async function suggest(defectClass = "roof_membrane_damage", extra: Record<string, unknown> = {}) {
  const [finding] = await recordFindings(asOwner(), photo.id, [
    { defectClass, confidence: 0.9, assetId: roof.id, boundingBox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, ...extra },
  ]);
  return finding;
}

beforeAll(async () => {
  for (const key of ["computer_vision"]) {
    await prisma.featureFlag.upsert({ where: { key }, create: { key, description: key, defaultEnabled: false }, update: {} });
  }
  org = await prisma.organization.create({ data: { name: `AF ${suffix}`, slug: `af-${suffix}` } });
  await prisma.featureFlagOverride.create({ data: { flagKey: "computer_vision", organizationId: org.id, enabled: true } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "TX", postalCode: "1" },
    });
  property = await mk("store");
  otherProperty = await mk("other");
  roof = await prisma.asset.create({
    data: { organizationId: org.id, propertyId: property.id, name: "Roof", assetType: "Roof", conditionScore: 80, criticalityScore: 4 },
  });
  otherAsset = await prisma.asset.create({
    data: { organizationId: org.id, propertyId: otherProperty.id, name: "Other roof", assetType: "Roof", conditionScore: 80 },
  });
  owner = await prisma.user.create({ data: { email: `owner-${suffix}@example.com`, name: "Owner", passwordHash: "x" } });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });
  photo = await prisma.evidence.create({
    data: { organizationId: org.id, propertyId: property.id, type: "PHOTO", storageKey: `${suffix}/roof.jpg`, uploadedById: owner.id },
  });
  await saveDefectRule(asOwner(), {
    defectClass: "roof_membrane_damage",
    label: "Roof membrane damage",
    assetCategory: "Roof",
    defaultSeverity: "HIGH",
    conditionPenalty: 20,
    defaultRepairCostCents: 850000,
  });
});

beforeEach(async () => {
  await prisma.aIFinding.deleteMany({ where: { evidenceId: photo.id } });
  await prisma.issue.deleteMany({ where: { organizationId: org.id } });
  await prisma.asset.update({ where: { id: roof.id }, data: { conditionScore: 80 } });
  await prisma.evidence.update({ where: { id: photo.id }, data: { issueId: null } });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.delete({ where: { id: owner.id } });
});

describe("recording a finding", () => {
  it("is only a suggestion: no issue, no score change", async () => {
    const finding = await suggest();
    expect(finding.status).toBe("SUGGESTED");
    expect(finding.label).toBe("Roof membrane damage");
    expect(await prisma.issue.count({ where: { organizationId: org.id } })).toBe(0);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: roof.id } })).conditionScore).toBe(80);
  });

  it("refuses a box outside the image", async () => {
    await expect(suggest("roof_membrane_damage", { boundingBox: { x: 0.8, y: 0.1, w: 0.5, h: 0.2 } })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("refuses an asset on a different property from the photo", async () => {
    await expect(suggest("roof_membrane_damage", { assetId: otherAsset.id })).rejects.toMatchObject({ status: 400 });
  });

  it("is refused when the organization has not turned AI detection on", async () => {
    await prisma.featureFlagOverride.update({
      where: { flagKey_organizationId: { flagKey: "computer_vision", organizationId: org.id } },
      data: { enabled: false },
    });
    try {
      await expect(suggest()).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.featureFlagOverride.update({
        where: { flagKey_organizationId: { flagKey: "computer_vision", organizationId: org.id } },
        data: { enabled: true },
      });
    }
  });
});

describe("confirming", () => {
  it("uses the organization's rule when the inspector changes nothing", async () => {
    const finding = await suggest();
    const issue = await confirmFinding(asOwner(), finding.id);

    expect(issue.severity).toBe("HIGH");
    expect(issue.estimatedCost).toBe(850000);
    expect(issue.source).toBe("AI_SUGGESTED");
    expect(issue.assetId).toBe(roof.id);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: roof.id } })).conditionScore).toBe(60);
    const history = await prisma.assetConditionHistory.findFirst({ where: { assetId: roof.id }, orderBy: { changedAt: "desc" } });
    expect(history).toMatchObject({ previousScore: 80, newScore: 60, source: "AI_SUGGESTED", evidenceId: photo.id });
    const stored = await prisma.aIFinding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(stored).toMatchObject({ status: "HUMAN_VERIFIED", issueId: issue.id, reviewedById: owner.id });
  });

  it("uses the inspector's values over the rule's", async () => {
    const finding = await suggest();
    const issue = await confirmFinding(asOwner(), finding.id, {
      severity: "CRITICAL",
      repairCostCents: 1234500,
      conditionPenalty: 45,
    });
    expect(issue.severity).toBe("CRITICAL");
    expect(issue.estimatedCost).toBe(1234500);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: roof.id } })).conditionScore).toBe(35);
  });

  it("lets the inspector record no cost at all", async () => {
    const finding = await suggest();
    const issue = await confirmFinding(asOwner(), finding.id, { repairCostCents: null });
    expect(issue.estimatedCost).toBeNull();
  });

  it("invents nothing when there is no rule and no severity", async () => {
    const finding = await suggest("unheard_of_defect");
    await expect(confirmFinding(asOwner(), finding.id)).rejects.toMatchObject({ status: 400 });
    // Nothing happened.
    expect(await prisma.issue.count({ where: { organizationId: org.id } })).toBe(0);
    expect((await prisma.aIFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("SUGGESTED");

    const issue = await confirmFinding(asOwner(), finding.id, { severity: "LOW" });
    expect(issue.severity).toBe("LOW");
    expect(issue.estimatedCost).toBeNull();
    // No rule, no penalty given: the score is left alone.
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: roof.id } })).conditionScore).toBe(80);
  });

  it("makes at most one issue, even if two people confirm at once", async () => {
    const finding = await suggest();
    const results = await Promise.allSettled([confirmFinding(asOwner(), finding.id), confirmFinding(asOwner(), finding.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.issue.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("is refused to a read-only viewer", async () => {
    const finding = await suggest();
    await expect(confirmFinding(ctx(Role.VIEWER), finding.id)).rejects.toMatchObject({ status: 403 });
  });

  it("cannot reach a finding on a building the inspector is not assigned to", async () => {
    const finding = await suggest();
    expect(await listFindings(asInspectorElsewhere())).toHaveLength(0);
    await expect(confirmFinding(asInspectorElsewhere(), finding.id)).rejects.toMatchObject({ status: 404 });
  });

  it("cannot reach another organization's finding", async () => {
    const finding = await suggest();
    await expect(confirmFinding({ ...asOwner(), organizationId: "someone-else" }, finding.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("rejecting", () => {
  it("closes the finding and changes nothing else", async () => {
    const finding = await suggest();
    await rejectFinding(asOwner(), finding.id, "That is a shadow, not ponding");
    const stored = await prisma.aIFinding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(stored).toMatchObject({ status: "REJECTED", reviewNote: "That is a shadow, not ponding", issueId: null });
    expect(await prisma.issue.count({ where: { organizationId: org.id } })).toBe(0);
    await expect(confirmFinding(asOwner(), finding.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("defect rules", () => {
  it("are changed only by admins", async () => {
    await expect(
      saveDefectRule(ctx(Role.TECHNICIAN), {
        defectClass: "x",
        label: "X",
        defaultSeverity: "LOW",
        conditionPenalty: 1,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("store the class the way models name it", () => {
    expect(normalizeDefectClass("  Concrete Spalling ")).toBe("concrete_spalling");
  });
});
