import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { requireFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { hasPermission } from "@/lib/permissions";
import { recordAssetConditionChange } from "@/lib/asset-condition";
import { recalculatePropertyHealth } from "@/lib/scoring";
import { notifyPropertyStakeholders } from "@/lib/notifications";
import { evidenceScopeWhere, propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { IssueSeverity, IssueSource, Prisma } from "@/generated/prisma/client";

/**
 * AI defect findings, with a person in the loop.
 *
 * A vision model looks at a photo and says what it sees: a defect class, a
 * confidence, a box on the image. That is all it says. It never creates an
 * issue, never changes a condition score, never touches health, risk or
 * cost. A finding sits as SUGGESTED until an inspector looks at it and
 * either confirms it — which is the moment an issue exists — or rejects it.
 *
 * What a defect class *means* (severity, repair cost, points off the asset's
 * condition) comes from the organization's own `DefectRule` table, and even
 * then only as a suggestion: the inspector can change every value when
 * confirming, and what they enter is what is recorded.
 *
 * Confirming goes through the same paths as everything else here: the issue
 * is an ordinary issue (source AI_SUGGESTED), and the condition change goes
 * through `recordAssetConditionChange`, which keeps history and recomputes
 * the asset's health and risk, followed by the property's health.
 */

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FindingInput {
  defectClass: string;
  confidence?: number | null;
  modelName?: string | null;
  assetId?: string | null;
  boundingBox?: BoundingBox | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  description?: string | null;
}

export interface ConfirmOverrides {
  severity?: IssueSeverity | null;
  repairCostCents?: number | null;
  conditionPenalty?: number | null;
  assetId?: string | null;
  title?: string | null;
  note?: string | null;
}

/** "roof_membrane_damage" -> "Roof membrane damage". */
export function humanizeDefectClass(defectClass: string): string {
  const words = defectClass.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function validBox(box: BoundingBox): boolean {
  const inUnit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  return inUnit(box.x) && inUnit(box.y) && inUnit(box.w) && inUnit(box.h) && box.x + box.w <= 1.0001 && box.y + box.h <= 1.0001;
}

/** Findings in this caller's reach: on evidence they could see, on a property they can see. */
function findingScopeWhere(ctx: SessionContext): Prisma.AIFindingWhereInput {
  return { evidence: { ...evidenceScopeWhere(ctx), property: propertyScopeWhere(ctx) } };
}

/** Records a model's findings on one photo. They are suggestions and change nothing else. */
export async function recordFindings(ctx: SessionContext, evidenceId: string, findings: FindingInput[]) {
  if (!hasPermission(ctx.role, "canUploadEvidence")) throw new ApiError(403, "Missing permission: canUploadEvidence");
  await requireFeature(ctx, FEATURE_FLAGS.COMPUTER_VISION);

  const evidence = await prisma.evidence.findFirst({
    where: { AND: [{ id: evidenceId }, evidenceScopeWhere(ctx)] },
    select: { id: true, propertyId: true },
  });
  if (!evidence) throw new ApiError(404, "Evidence not found");
  if (!evidence.propertyId) throw new ApiError(400, "A finding needs a photo that belongs to a property");

  const assetIds = [...new Set(findings.map((f) => f.assetId).filter((id): id is string => !!id))];
  if (assetIds.length > 0) {
    const found = await prisma.asset.count({ where: { id: { in: assetIds }, propertyId: evidence.propertyId } });
    if (found !== assetIds.length) throw new ApiError(400, "Every asset must be on the same property as the photo");
  }
  for (const f of findings) {
    if (!f.defectClass.trim()) throw new ApiError(400, "Each finding needs a defect class");
    if (f.confidence !== undefined && f.confidence !== null && !(f.confidence >= 0 && f.confidence <= 1)) {
      throw new ApiError(400, "Confidence is a number from 0 to 1");
    }
    if (f.boundingBox && !validBox(f.boundingBox)) {
      throw new ApiError(400, "A box is x, y, w, h as fractions of the image, each from 0 to 1, inside the image");
    }
  }

  const rules = await prisma.defectRule.findMany({
    where: { organizationId: ctx.organizationId, defectClass: { in: findings.map((f) => f.defectClass.trim()) } },
    select: { defectClass: true, label: true },
  });
  const labelFor = new Map(rules.map((r) => [r.defectClass, r.label]));

  const created = await prisma.$transaction(
    findings.map((f) => {
      const defectClass = f.defectClass.trim();
      return prisma.aIFinding.create({
        data: {
          evidenceId: evidence.id,
          defectClass,
          label: labelFor.get(defectClass) ?? humanizeDefectClass(defectClass),
          description: f.description ?? null,
          confidence: f.confidence ?? null,
          modelName: f.modelName ?? null,
          assetId: f.assetId ?? null,
          boundingBox: f.boundingBox ? (f.boundingBox as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          imageWidth: f.imageWidth ?? null,
          imageHeight: f.imageHeight ?? null,
        },
      });
    }),
  );

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "ai_finding.recorded",
    entityType: "Evidence",
    entityId: evidence.id,
    metadata: { count: created.length, classes: [...new Set(created.map((c) => c.defectClass))] },
  });
  return created;
}

/** The review queue, or any status of it. */
export async function listFindings(ctx: SessionContext, status: "SUGGESTED" | "HUMAN_VERIFIED" | "REJECTED" = "SUGGESTED") {
  return prisma.aIFinding.findMany({
    where: { AND: [findingScopeWhere(ctx), { status }] },
    orderBy: { createdAt: status === "SUGGESTED" ? "asc" : "desc" },
    take: 200,
    include: {
      evidence: { select: { id: true, propertyId: true, property: { select: { id: true, name: true } } } },
      asset: { select: { id: true, name: true, conditionScore: true } },
      issue: { select: { id: true, title: true } },
      reviewedBy: { select: { name: true } },
    },
  });
}

function requireReviewer(ctx: SessionContext) {
  if (!hasPermission(ctx.role, "canPerformAssessments")) {
    throw new ApiError(403, "Only someone who performs assessments can confirm or reject AI findings");
  }
}

async function loadSuggested(ctx: SessionContext, findingId: string) {
  const finding = await prisma.aIFinding.findFirst({
    where: { AND: [{ id: findingId }, findingScopeWhere(ctx)] },
    include: { evidence: { select: { id: true, propertyId: true, issueId: true } } },
  });
  if (!finding) throw new ApiError(404, "Finding not found");
  if (finding.status !== "SUGGESTED") throw new ApiError(409, "This finding has already been reviewed");
  return finding;
}

/**
 * Confirms a finding: creates the issue and, when a penalty applies to an
 * asset, records the asset's new condition. The inspector's values win; the
 * organization's rule fills only what they left blank; nothing is invented
 * when neither says.
 */
export async function confirmFinding(ctx: SessionContext, findingId: string, overrides: ConfirmOverrides = {}) {
  requireReviewer(ctx);
  const finding = await loadSuggested(ctx, findingId);
  const propertyId = finding.evidence.propertyId;
  if (!propertyId) throw new ApiError(400, "This finding's photo is not on a property");

  const rule = finding.defectClass
    ? await prisma.defectRule.findUnique({
        where: { organizationId_defectClass: { organizationId: ctx.organizationId, defectClass: finding.defectClass } },
      })
    : null;

  const severity = overrides.severity ?? rule?.defaultSeverity ?? null;
  if (!severity) {
    // No silent default: a made-up "HIGH" would move health and risk scores
    // on a number nobody chose.
    throw new ApiError(400, "There is no defect rule for this class. Choose a severity.");
  }
  const repairCostCents = overrides.repairCostCents !== undefined ? overrides.repairCostCents : (rule?.defaultRepairCostCents ?? null);
  if (repairCostCents !== null && (!Number.isInteger(repairCostCents) || repairCostCents < 0)) {
    throw new ApiError(400, "Repair cost must be a whole number of cents, 0 or more");
  }
  const penalty = overrides.conditionPenalty !== undefined && overrides.conditionPenalty !== null
    ? overrides.conditionPenalty
    : (rule?.conditionPenalty ?? 0);
  if (!Number.isInteger(penalty) || penalty < 0 || penalty > 100) {
    throw new ApiError(400, "The condition hit is a whole number of points from 0 to 100");
  }

  const assetId = overrides.assetId !== undefined ? overrides.assetId : finding.assetId;
  const asset = assetId
    ? await prisma.asset.findFirst({ where: { id: assetId, propertyId }, select: { id: true, conditionScore: true, name: true } })
    : null;
  if (assetId && !asset) throw new ApiError(400, "That asset is not on this property");

  const title = overrides.title?.trim() || rule?.label || finding.label;
  const now = new Date();

  const issue = await prisma.$transaction(async (tx) => {
    // Claimed in the same statement that checks it is still a suggestion, so
    // two inspectors confirming at once cannot create two issues.
    const { count } = await tx.aIFinding.updateMany({
      where: { id: finding.id, status: "SUGGESTED" },
      data: { status: "HUMAN_VERIFIED", reviewedById: ctx.userId, reviewedAt: now, reviewNote: overrides.note?.trim() || null },
    });
    if (count === 0) throw new ApiError(409, "This finding has already been reviewed");

    const created = await tx.issue.create({
      data: {
        organizationId: ctx.organizationId,
        propertyId,
        assetId: asset?.id ?? null,
        title,
        description:
          `Confirmed by an inspector from an AI finding${finding.confidence !== null ? ` (model confidence ${Math.round(finding.confidence * 100)}%)` : ""}.` +
          (overrides.note?.trim() ? `\n\n${overrides.note.trim()}` : ""),
        severity,
        source: IssueSource.AI_SUGGESTED,
        estimatedCost: repairCostCents,
        createdById: ctx.userId,
      },
    });
    await tx.aIFinding.update({ where: { id: finding.id }, data: { issueId: created.id, assetId: asset?.id ?? null } });
    // The photo becomes the issue's evidence, unless it already belongs to another.
    if (!finding.evidence.issueId) {
      await tx.evidence.update({ where: { id: finding.evidence.id }, data: { issueId: created.id } });
    }
    return created;
  });

  // Through the one path that keeps condition history and recomputes the
  // asset's health and risk. Run after the issue commits: it opens its own
  // transaction, and a failure here leaves a correct issue rather than none.
  // An asset with no condition score yet is left alone: taking points off
  // nothing would mean inventing the starting score.
  if (asset && penalty > 0 && asset.conditionScore !== null) {
    await recordAssetConditionChange({
      assetId: asset.id,
      newScore: Math.max(0, asset.conditionScore - penalty),
      changedByUserId: ctx.userId,
      source: IssueSource.AI_SUGGESTED,
      reason: `${title} (confirmed AI finding, −${penalty})`,
      evidenceId: finding.evidence.id,
      validationStatus: "AI_HUMAN_VERIFIED",
    });
  }
  await recalculatePropertyHealth(propertyId);

  await Promise.all([
    writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "ai_finding.confirmed",
      entityType: "AIFinding",
      entityId: finding.id,
      metadata: {
        issueId: issue.id,
        defectClass: finding.defectClass,
        severity,
        repairCostCents,
        penalty,
        overridden: {
          severity: overrides.severity != null && overrides.severity !== rule?.defaultSeverity,
          repairCost: overrides.repairCostCents !== undefined && overrides.repairCostCents !== rule?.defaultRepairCostCents,
          penalty: overrides.conditionPenalty != null && overrides.conditionPenalty !== rule?.conditionPenalty,
        },
      },
    }),
    emitEvent({
      organizationId: ctx.organizationId,
      propertyId,
      type: EVENT_TYPES.ISSUE_CREATED,
      actorUserId: ctx.userId,
      payload: { issueId: issue.id, title: issue.title, severity: issue.severity, fromAIFinding: finding.id },
    }),
  ]);
  if (severity === "CRITICAL") {
    try {
      await notifyPropertyStakeholders({
        propertyId,
        type: "ISSUE_CRITICAL",
        title: `Critical issue: ${issue.title}`,
        link: `/issues/${issue.id}`,
      });
    } catch {
      // The issue is recorded either way.
    }
  }
  return issue;
}

export async function rejectFinding(ctx: SessionContext, findingId: string, note?: string | null) {
  requireReviewer(ctx);
  const finding = await loadSuggested(ctx, findingId);
  const { count } = await prisma.aIFinding.updateMany({
    where: { id: finding.id, status: "SUGGESTED" },
    data: { status: "REJECTED", reviewedById: ctx.userId, reviewedAt: new Date(), reviewNote: note?.trim() || null },
  });
  if (count === 0) throw new ApiError(409, "This finding has already been reviewed");
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "ai_finding.rejected",
    entityType: "AIFinding",
    entityId: finding.id,
    metadata: { defectClass: finding.defectClass, note: note?.trim() || null },
  });
}

// ---------------------------------------------------------------------------
// Defect rules — the organization's own meaning for each defect class.
// ---------------------------------------------------------------------------

function requireRuleManager(ctx: SessionContext) {
  if (!hasPermission(ctx.role, "canManageAssessmentTemplates")) {
    throw new ApiError(403, "Only an admin can change defect rules");
  }
}

export async function listDefectRules(ctx: SessionContext) {
  return prisma.defectRule.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { label: "asc" } });
}

export interface DefectRuleInput {
  defectClass: string;
  label: string;
  assetCategory?: string | null;
  defaultSeverity: IssueSeverity;
  conditionPenalty: number;
  defaultRepairCostCents?: number | null;
}

/** Normalises a class name the way models emit them: lower-case words joined by underscores. */
export function normalizeDefectClass(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export async function saveDefectRule(ctx: SessionContext, input: DefectRuleInput) {
  requireRuleManager(ctx);
  const defectClass = normalizeDefectClass(input.defectClass);
  if (!defectClass) throw new ApiError(400, "Give the defect class the model uses, e.g. concrete_spalling");
  if (!input.label.trim()) throw new ApiError(400, "Give the rule a name people will read");
  if (!Number.isInteger(input.conditionPenalty) || input.conditionPenalty < 0 || input.conditionPenalty > 100) {
    throw new ApiError(400, "The condition hit is a whole number of points from 0 to 100");
  }
  const data = {
    label: input.label.trim(),
    assetCategory: input.assetCategory?.trim() || null,
    defaultSeverity: input.defaultSeverity,
    conditionPenalty: input.conditionPenalty,
    defaultRepairCostCents: input.defaultRepairCostCents ?? null,
  };
  const rule = await prisma.defectRule.upsert({
    where: { organizationId_defectClass: { organizationId: ctx.organizationId, defectClass } },
    create: { organizationId: ctx.organizationId, defectClass, ...data },
    update: data,
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "defect_rule.saved",
    entityType: "DefectRule",
    entityId: rule.id,
    metadata: { defectClass, ...data },
  });
  return rule;
}

export async function deleteDefectRule(ctx: SessionContext, ruleId: string) {
  requireRuleManager(ctx);
  const { count } = await prisma.defectRule.deleteMany({ where: { id: ruleId, organizationId: ctx.organizationId } });
  if (count === 0) throw new ApiError(404, "Defect rule not found");
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "defect_rule.deleted",
    entityType: "DefectRule",
    entityId: ruleId,
  });
}
