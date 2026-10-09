import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { evidenceScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { hasPermission } from "@/lib/permissions";
import { getAIProvider } from "@/lib/ai/provider-factory";
import { AIProviderNotConfiguredError, type JSONSchemaObject } from "@/lib/ai/provider";
import { recordAssetConditionChange } from "@/lib/asset-condition";
import { recordUsage } from "@/lib/cost-metering";
import { writeAuditLog } from "@/lib/audit";
import { logEvent } from "@/lib/observability";
import { getStorageProvider } from "@/lib/storage";
import {
  AIFindingStatus,
  IssueSeverity,
  IssueSource,
  Role,
  UsageMetricType,
  ValidationStatus,
} from "@/generated/prisma/client";

/**
 * AI PHOTO ANALYSIS — suggest first, apply only once a person confirms.
 *
 *   1. `analyzeEvidencePhoto`: the model looks at one photo of one asset and
 *      writes an AIFinding in SUGGESTED. Nothing about the asset or the
 *      property's health changes. A model's guess is not a condition rating.
 *   2. `reviewAIFinding`: the vendor (or any staff member who can see the
 *      photo) confirms it, optionally correcting the score, or rejects it.
 *      Only a confirmation reaches `recordAssetConditionChange`, the one path
 *      that writes condition history and recalculates the property, and it
 *      arrives marked AI_HUMAN_VERIFIED with the photo attached as evidence.
 *
 * The model is never asked for the asset's current score. Showing it the
 * number it is meant to be checking would anchor it on that number.
 */

/**
 * Anthropic's limit for one base64 image is 5 MB, and the other vendors are
 * in the same range. Above it, refused with a reason rather than sent to fail.
 */
export const MAX_ANALYZE_BYTES = 5 * 1024 * 1024;

const SUPPORTED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/**
 * What the model must return. Every property required and no numeric bounds
 * in the schema itself: that is the subset all three vendors' structured
 * output modes accept. Bounds are enforced by `analysisOutput` below instead.
 */
const ANALYSIS_SCHEMA: JSONSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "imageUsable",
    "label",
    "description",
    "conditionScore",
    "severity",
    "confidence",
    "defects",
    "recommendedAction",
  ],
  properties: {
    imageUsable: {
      type: "boolean",
      description: "False when the photo is too dark, blurred, obstructed, or does not show this asset.",
    },
    label: { type: "string", description: "One-line headline of the main finding, under 80 characters." },
    description: { type: "string", description: "Two to four sentences on what is visible and why it matters." },
    conditionScore: { type: "integer", description: "Condition from 0 (failed) to 100 (new). 0 if imageUsable is false." },
    severity: { type: "string", enum: [...SEVERITIES], description: "Severity of the worst defect seen." },
    confidence: { type: "number", description: "Your confidence in the score, from 0 to 1." },
    defects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "severity", "location"],
        properties: {
          label: { type: "string" },
          severity: { type: "string", enum: [...SEVERITIES] },
          location: { type: "string", description: "Where in the photo, e.g. 'lower left flashing'." },
        },
      },
    },
    recommendedAction: { type: "string", description: "What a facilities manager should do next." },
  },
};

const analysisOutput = z.object({
  imageUsable: z.boolean(),
  label: z.string().min(1).max(200),
  description: z.string().max(4000),
  conditionScore: z.number().int().min(0).max(100),
  severity: z.enum(SEVERITIES),
  confidence: z.number().min(0).max(1),
  defects: z
    .array(z.object({ label: z.string().max(200), severity: z.enum(SEVERITIES), location: z.string().max(200) }))
    .max(50),
  recommendedAction: z.string().max(2000),
});

const SYSTEM_PROMPT = `You are a commercial building condition assessor reviewing a field photo of one building asset.

Rules:
- Rate only what is visible in this photo. Do not infer hidden damage or invent defects.
- If the photo is too dark, blurred, obstructed, or does not show the named asset, set imageUsable to false, say why in description, and set conditionScore to 0 and confidence to 0.
- Use this condition scale, the same one the platform scores buildings on:
  90-100 Excellent: like new, no visible wear.
  80-89 Good: minor cosmetic wear only.
  65-79 Needs Attention: visible wear or early defects; plan maintenance.
  50-64 Poor: clear defects affecting function; repair soon.
  0-49 Critical: failed or failing, or a safety hazard; act now.
- Be honest about uncertainty with the confidence value. A person will check your rating before it is used.`;

function buildPrompt(asset: {
  name: string;
  assetType: string;
  manufacturer: string | null;
  model: string | null;
  installedAt: Date | null;
  expectedUsefulLifeYears: number | null;
}): string {
  const lines = [`Asset: ${asset.name}`, `Type: ${asset.assetType}`];
  if (asset.manufacturer || asset.model) {
    lines.push(`Make/model: ${[asset.manufacturer, asset.model].filter(Boolean).join(" ")}`);
  }
  if (asset.installedAt) {
    const years = (Date.now() - asset.installedAt.getTime()) / (365.25 * 86400000);
    lines.push(`Age: about ${Math.max(0, Math.round(years))} years`);
  }
  if (asset.expectedUsefulLifeYears) lines.push(`Expected useful life: ${asset.expectedUsefulLifeYears} years`);
  lines.push("", "Assess the condition of this asset from the photo.");
  return lines.join("\n");
}

/**
 * A vendor works only with photos they took. Staff may analyse any photo
 * they can see. The analysis costs money per call, and a subcontractor rating
 * someone else's capture is not the work they were sent to do.
 */
function vendorOwnsOnly(ctx: SessionContext): { uploadedById?: string } {
  return ctx.role === Role.VENDOR ? { uploadedById: ctx.userId } : {};
}

/**
 * Checked here as well as in the routes: the read-only role is org-wide, so
 * it passes every scope check below, and the page calls this service directly.
 */
function assertMayRate(ctx: SessionContext): void {
  if (!hasPermission(ctx.role, "canUploadEvidence")) {
    throw new ApiError(403, "You do not have permission to rate photos");
  }
}

export async function analyzeEvidencePhoto(
  ctx: SessionContext,
  evidenceId: string,
  options: { assetId?: string | null } = {},
) {
  assertMayRate(ctx);
  const evidence = await prisma.evidence.findFirst({
    where: { id: evidenceId, ...evidenceScopeWhere(ctx), ...vendorOwnsOnly(ctx) },
    select: {
      id: true,
      propertyId: true,
      assetId: true,
      type: true,
      mimeType: true,
      sizeBytes: true,
      storageKey: true,
    },
  });
  if (!evidence) throw new ApiError(404, "Evidence not found");

  const mimeType = (evidence.mimeType ?? "").toLowerCase();
  if (!SUPPORTED_MEDIA_TYPES.includes(mimeType)) {
    throw new ApiError(400, "Only JPEG, PNG, GIF or WebP photos can be analysed");
  }
  if (evidence.type === "IMAGE_360") {
    // An equirectangular panorama is a distorted view of a whole room; the
    // rating would be of the distortion as much as the asset.
    throw new ApiError(400, "360° panoramas cannot be analysed; use a regular photo of the asset");
  }
  if (evidence.sizeBytes !== null && Number(evidence.sizeBytes) > MAX_ANALYZE_BYTES) {
    throw new ApiError(400, "This photo is larger than 5 MB; upload a smaller copy to analyse it");
  }

  const assetId = options.assetId ?? evidence.assetId;
  if (!assetId) throw new ApiError(400, "Choose which asset this photo shows");

  const asset = await prisma.asset.findFirst({
    // The asset has to be on the photo's own property: a photo of one
    // building must not be able to rate an asset in another.
    where: { id: assetId, organizationId: ctx.organizationId, propertyId: evidence.propertyId ?? "__none__", status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      assetType: true,
      manufacturer: true,
      model: true,
      installedAt: true,
      expectedUsefulLifeYears: true,
    },
  });
  if (!asset) throw new ApiError(400, "That asset is not on this photo's property");

  // An open suggestion for the same photo and asset is returned as-is rather
  // than paid for twice by a double click.
  const open = await prisma.aIFinding.findFirst({
    where: { evidenceId: evidence.id, assetId: asset.id, status: AIFindingStatus.SUGGESTED },
  });
  if (open) return open;

  const bytes = await getStorageProvider().readBytes(evidence.storageKey);
  if (!bytes) throw new ApiError(404, "This evidence file is no longer present in storage");
  if (bytes.byteLength > MAX_ANALYZE_BYTES) {
    throw new ApiError(400, "This photo is larger than 5 MB; upload a smaller copy to analyse it");
  }

  const provider = getAIProvider();
  const startedAt = Date.now();
  let result;
  try {
    result = await provider.analyzeImage({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(asset),
      image: { mediaType: mimeType, base64: bytes.toString("base64") },
      schema: ANALYSIS_SCHEMA,
    });
  } catch (err) {
    if (err instanceof AIProviderNotConfiguredError) {
      throw new ApiError(503, "AI photo analysis is not configured in this environment (no AI provider key is set)");
    }
    logEvent("ai.provider_call", {
      ok: false,
      organizationId: ctx.organizationId,
      provider: provider.name,
      durationMs: Date.now() - startedAt,
      errorMessage: err instanceof Error ? err.message : "unknown",
    });
    throw new ApiError(502, "The AI provider could not analyse this photo. Try again, or rate it by hand.");
  }

  // Metered before validation: the call was made and billed whatever it returned.
  await recordUsage({
    organizationId: ctx.organizationId,
    propertyId: evidence.propertyId,
    metricType: UsageMetricType.AI_REQUEST,
    quantity: 1,
    source: "photo-analysis",
    metadata: { provider: provider.name, evidenceId: evidence.id },
  });
  if (result.usage) {
    await recordUsage({
      organizationId: ctx.organizationId,
      propertyId: evidence.propertyId,
      metricType: UsageMetricType.AI_INPUT_TOKENS,
      quantity: result.usage.inputTokens,
      source: "photo-analysis",
      metadata: { provider: provider.name },
    });
    await recordUsage({
      organizationId: ctx.organizationId,
      propertyId: evidence.propertyId,
      metricType: UsageMetricType.AI_OUTPUT_TOKENS,
      quantity: result.usage.outputTokens,
      source: "photo-analysis",
      metadata: { provider: provider.name },
    });
  }
  logEvent("ai.provider_call", {
    ok: true,
    organizationId: ctx.organizationId,
    provider: provider.name,
    durationMs: Date.now() - startedAt,
  });

  const parsed = analysisOutput.safeParse(result.output);
  if (!parsed.success) {
    throw new ApiError(502, "The AI provider returned an answer in the wrong shape. Try again, or rate it by hand.");
  }
  const out = parsed.data;

  return prisma.aIFinding.create({
    data: {
      organizationId: ctx.organizationId,
      evidenceId: evidence.id,
      assetId: asset.id,
      label: out.imageUsable ? out.label : `Photo not usable: ${out.label}`,
      description: out.description,
      // An unusable photo carries no score. The reviewer can still enter one
      // by hand, or reject it.
      suggestedScore: out.imageUsable ? out.conditionScore : null,
      suggestedSeverity: out.imageUsable ? (out.severity as IssueSeverity) : null,
      confidence: out.imageUsable ? out.confidence : 0,
      defects: out.imageUsable ? out.defects : [],
      recommendedAction: out.recommendedAction,
      provider: provider.name,
      requestedById: ctx.userId,
    },
  });
}

export async function reviewAIFinding(
  ctx: SessionContext,
  findingId: string,
  input: { decision: "confirm" | "reject"; score?: number | null; note?: string | null },
) {
  assertMayRate(ctx);
  const finding = await prisma.aIFinding.findFirst({
    where: { id: findingId, organizationId: ctx.organizationId, evidence: { ...evidenceScopeWhere(ctx), ...vendorOwnsOnly(ctx) } },
    include: { asset: { select: { id: true, name: true, propertyId: true, status: true } } },
  });
  if (!finding) throw new ApiError(404, "Finding not found");
  if (finding.status !== AIFindingStatus.SUGGESTED) throw new ApiError(409, "This finding has already been reviewed");

  const note = input.note?.trim() || null;

  if (input.decision === "reject") {
    const claimed = await prisma.aIFinding.updateMany({
      where: { id: finding.id, status: AIFindingStatus.SUGGESTED },
      data: { status: AIFindingStatus.REJECTED, reviewedById: ctx.userId, reviewedAt: new Date(), reviewNote: note },
    });
    if (claimed.count === 0) throw new ApiError(409, "This finding has already been reviewed");
    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "ai_finding.rejected",
      entityType: "AIFinding",
      entityId: finding.id,
      metadata: { suggestedScore: finding.suggestedScore },
    });
    return prisma.aIFinding.findUniqueOrThrow({ where: { id: finding.id } });
  }

  if (!finding.asset || finding.asset.status !== "ACTIVE") {
    throw new ApiError(409, "The asset this finding rates no longer exists or is inactive");
  }
  const score = input.score ?? finding.suggestedScore;
  if (score === null || score === undefined) {
    throw new ApiError(400, "The AI gave no score for this photo; enter one to confirm, or reject it");
  }

  // Claimed before applying, so two reviewers confirming at once cannot both
  // write a condition change.
  const claimed = await prisma.aIFinding.updateMany({
    where: { id: finding.id, status: AIFindingStatus.SUGGESTED },
    data: {
      status: AIFindingStatus.HUMAN_VERIFIED,
      confirmedScore: score,
      reviewedById: ctx.userId,
      reviewedAt: new Date(),
      reviewNote: note,
    },
  });
  if (claimed.count === 0) throw new ApiError(409, "This finding has already been reviewed");

  const adjusted = finding.suggestedScore !== null && score !== finding.suggestedScore;
  try {
    await recordAssetConditionChange({
      assetId: finding.asset.id,
      newScore: score,
      changedByUserId: ctx.userId,
      source: IssueSource.AI_SUGGESTED,
      validationStatus: ValidationStatus.AI_HUMAN_VERIFIED,
      evidenceId: finding.evidenceId,
      reason:
        `AI photo analysis confirmed: ${finding.label}` +
        (adjusted ? ` (AI suggested ${finding.suggestedScore}, reviewer set ${score})` : "") +
        (note ? ` — ${note}` : ""),
    });
  } catch (err) {
    // Put the finding back so it can be confirmed again, rather than leaving
    // it marked verified with no condition change behind it.
    await prisma.aIFinding.update({
      where: { id: finding.id },
      data: { status: AIFindingStatus.SUGGESTED, confirmedScore: null, reviewedById: null, reviewedAt: null, reviewNote: null },
    });
    throw err;
  }

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "ai_finding.confirmed",
    entityType: "AIFinding",
    entityId: finding.id,
    metadata: { assetId: finding.asset.id, suggestedScore: finding.suggestedScore, confirmedScore: score },
  });

  return prisma.aIFinding.findUniqueOrThrow({ where: { id: finding.id } });
}

/**
 * Photos on a capture-job site with their findings, for the review panel.
 * Vendors see only what they uploaded, matching what they may act on.
 */
export async function getSitePhotoFindings(ctx: SessionContext, siteId: string) {
  if (!hasPermission(ctx.role, "canUploadEvidence")) return [];
  return prisma.evidence.findMany({
    where: {
      captureJobSiteId: siteId,
      type: { in: ["PHOTO", "DRONE_IMAGE"] },
      mimeType: { in: SUPPORTED_MEDIA_TYPES },
      ...evidenceScopeWhere(ctx),
      ...vendorOwnsOnly(ctx),
    },
    select: {
      id: true,
      assetId: true,
      createdAt: true,
      captureShot: { select: { label: true } },
      aiFindings: {
        orderBy: { createdAt: "desc" },
        include: { asset: { select: { id: true, name: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
}
