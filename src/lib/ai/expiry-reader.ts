import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { evidenceScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { getAIProvider } from "@/lib/ai/provider-factory";
import { AIProviderNotConfiguredError, type JSONSchemaObject } from "@/lib/ai/provider";
import { MAX_ANALYZE_BYTES, SUPPORTED_MEDIA_TYPES } from "@/lib/ai/photo-analysis";
import { assertMayRecord, loadScopedAsset } from "@/lib/expiry-service";
import { EXPIRY_KINDS, calendarDay, dateFromParts, isoDay } from "@/lib/expiry-rules";
import { recordUsage } from "@/lib/cost-metering";
import { writeAuditLog } from "@/lib/audit";
import { logEvent } from "@/lib/observability";
import { getStorageProvider } from "@/lib/storage";
import { ExpirySource, ExpiryStatus, UsageMetricType } from "@/generated/prisma/client";

/**
 * Reads the expiry date off a photographed tag.
 *
 * Someone photographs the inspection tag on a fire extinguisher, the
 * certificate on a hood, a permit on the wall. A vision model reads what is
 * printed or punched on it, and the date goes into expiry tracking, where it
 * counts down and the people responsible are told as it nears.
 *
 * A date read by a model is a record somebody will later rely on to keep a
 * restaurant legal, so it is held to a stricter standard than a condition
 * score:
 *   - It never guesses. A tag the model cannot read, or reads with low
 *     confidence, creates nothing and says why; the person types the date.
 *   - A date is built from the year, month and day as separate numbers, so a
 *     "03/04" is never silently read as the wrong way round.
 *   - What it does create is marked as needing a person's check, and every
 *     reminder for it says so, until someone confirms or corrects the date.
 */

/** Below this the model is guessing; the person is asked to enter the date. */
export const MIN_READ_CONFIDENCE = 0.5;

const OTHER = "Other";

function readSchema(): JSONSchemaObject {
  const dateParts = (what: string) => ({
    [`${what}Year`]: { type: "integer", description: `Four-digit year of the ${what} date, or 0 if not shown.` },
    [`${what}Month`]: { type: "integer", description: `Month 1-12 of the ${what} date, or 0 if not shown.` },
    [`${what}Day`]: { type: "integer", description: `Day of month of the ${what} date, or 0 if only the month and year are shown.` },
  });
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "isTagReadable",
      "kind",
      "otherKind",
      "expiryYear",
      "expiryMonth",
      "expiryDay",
      "lastInspectedYear",
      "lastInspectedMonth",
      "lastInspectedDay",
      "servicedBy",
      "confidence",
      "notes",
    ],
    properties: {
      isTagReadable: {
        type: "boolean",
        description: "False when the photo is blurred, dark, glared, too far away, or shows no tag, certificate or permit.",
      },
      kind: { type: "string", enum: [...EXPIRY_KINDS, OTHER], description: "What kind of tag or certificate this is." },
      otherKind: { type: "string", description: `If kind is "${OTHER}", what it is in a few words; otherwise an empty string.` },
      ...dateParts("expiry"),
      ...dateParts("lastInspected"),
      servicedBy: { type: "string", description: "The company named on the tag, or an empty string." },
      confidence: { type: "number", description: "Your confidence in the expiry date you reported, from 0 to 1." },
      notes: { type: "string", description: "One sentence on anything a person should know: a smudged digit, a date you could not read." },
    },
  };
}

const SYSTEM_PROMPT = `You read inspection tags, certificates, permits and warranty labels from close-up photos for a restaurant operator. The date you report will be counted down and people will be emailed before it runs out, so a wrong date is worse than no date.

Rules:
- Report only what is printed, written or punched on the tag in this photo. Never infer a date that is not visible, and never calculate one (do not add a year to an inspection date).
- The expiry date is the date the tag says the inspection, certificate or permit is due or expires ("Next due", "Expires", "Valid through"). If the tag shows only when it was last inspected, report that as the last inspected date and report the expiry year, month and day as 0.
- Report the year, month and day as separate numbers. If the tag shows only a month and year, give the day as 0. If it shows a year alone, give the month as 0.
- Fire extinguisher tags are often punched by month and year: read which month and year positions are punched, and report only those.
- If you cannot read it with confidence (blur, glare, a smudged digit, the photo is of something else), set isTagReadable to false and say why in notes. Do not guess to be helpful.
- Be honest about uncertainty with the confidence value. A person will check what you read before relying on it.`;

const readOutput = z.object({
  isTagReadable: z.boolean(),
  kind: z.string().max(200),
  otherKind: z.string().max(200),
  expiryYear: z.number().int().min(0).max(9999),
  expiryMonth: z.number().int().min(0).max(12),
  expiryDay: z.number().int().min(0).max(31),
  lastInspectedYear: z.number().int().min(0).max(9999),
  lastInspectedMonth: z.number().int().min(0).max(12),
  lastInspectedDay: z.number().int().min(0).max(31),
  servicedBy: z.string().max(200),
  confidence: z.number().min(0).max(1),
  notes: z.string().max(1000),
});

export interface TagReading {
  kind: string;
  expiresOn: string | null;
  lastInspectedOn: string | null;
  servicedBy: string | null;
  confidence: number;
  notes: string;
}

export type TagReadResult =
  | { created: true; id: string; reading: TagReading; alreadyExpired: boolean }
  | { created: false; reason: "unreadable" | "low_confidence" | "no_date" | "duplicate"; message: string; reading: TagReading | null; existingId?: string };

/**
 * Reads one photo of a tag on one asset, and records what it says.
 * Who may do this, and which photos they may use, is decided here.
 */
export async function readExpiryTag(
  ctx: SessionContext,
  input: { assetId: string; evidenceId: string },
): Promise<TagReadResult> {
  assertMayRecord(ctx);
  const asset = await loadScopedAsset(ctx, input.assetId);

  const evidence = await prisma.evidence.findFirst({
    where: { id: input.evidenceId, ...evidenceScopeWhere(ctx), propertyId: asset.propertyId },
    select: { id: true, type: true, mimeType: true, sizeBytes: true, storageKey: true },
  });
  if (!evidence) throw new ApiError(404, "Photo not found at this store");

  const mimeType = (evidence.mimeType ?? "").toLowerCase();
  if (evidence.type !== "PHOTO" || !SUPPORTED_MEDIA_TYPES.includes(mimeType)) {
    // A 360 panorama or a Matterport capture is far too wide and distorted to
    // read small print from; a regular close-up is what this needs.
    throw new ApiError(400, "Take a close-up photo of the tag itself. Only JPEG, PNG, GIF or WebP photos can be read, not 360° or 3D captures");
  }
  if (evidence.sizeBytes !== null && Number(evidence.sizeBytes) > MAX_ANALYZE_BYTES) {
    throw new ApiError(400, "This photo is larger than 5 MB; upload a smaller copy");
  }
  const bytes = await getStorageProvider().readBytes(evidence.storageKey);
  if (!bytes) throw new ApiError(404, "This photo is no longer present in storage");
  if (bytes.byteLength > MAX_ANALYZE_BYTES) throw new ApiError(400, "This photo is larger than 5 MB; upload a smaller copy");

  const provider = getAIProvider();
  const startedAt = Date.now();
  let raw;
  try {
    raw = await provider.analyzeImage({
      system: SYSTEM_PROMPT,
      prompt: `Read the date on this tag. It is on: ${asset.name} (${asset.assetType}).`,
      image: { mediaType: mimeType, base64: bytes.toString("base64") },
      schema: readSchema(),
    });
  } catch (err) {
    if (err instanceof AIProviderNotConfiguredError) {
      throw new ApiError(503, "Reading photos is not set up in this environment (no AI provider key). Enter the date by hand.");
    }
    logEvent("ai.expiry_read", {
      ok: false,
      organizationId: ctx.organizationId,
      provider: provider.name,
      durationMs: Date.now() - startedAt,
      errorMessage: err instanceof Error ? err.message : "unknown",
    });
    throw new ApiError(502, "The AI provider could not read this photo. Try again, or enter the date by hand.");
  }

  // Metered before validation: the call was made and billed whatever it returned.
  await recordUsage({
    organizationId: ctx.organizationId,
    propertyId: asset.propertyId,
    metricType: UsageMetricType.AI_REQUEST,
    quantity: 1,
    source: "expiry-read",
    metadata: { provider: provider.name, evidenceId: evidence.id },
  });
  if (raw.usage) {
    await recordUsage({
      organizationId: ctx.organizationId,
      propertyId: asset.propertyId,
      metricType: UsageMetricType.AI_INPUT_TOKENS,
      quantity: raw.usage.inputTokens,
      source: "expiry-read",
      metadata: { provider: provider.name },
    });
    await recordUsage({
      organizationId: ctx.organizationId,
      propertyId: asset.propertyId,
      metricType: UsageMetricType.AI_OUTPUT_TOKENS,
      quantity: raw.usage.outputTokens,
      source: "expiry-read",
      metadata: { provider: provider.name },
    });
  }
  logEvent("ai.expiry_read", { ok: true, organizationId: ctx.organizationId, provider: provider.name, durationMs: Date.now() - startedAt });

  const parsed = readOutput.safeParse(raw.output);
  if (!parsed.success) {
    throw new ApiError(502, "The AI provider answered in the wrong shape. Try again, or enter the date by hand.");
  }
  const out = parsed.data;
  const today = calendarDay(new Date());

  const expiry = dateFromParts({ year: out.expiryYear, month: out.expiryMonth, day: out.expiryDay }, today);
  const lastInspected = dateFromParts(
    { year: out.lastInspectedYear, month: out.lastInspectedMonth, day: out.lastInspectedDay },
    today,
  );
  const kind = out.kind === OTHER || !out.kind ? out.otherKind.trim() || "Inspection tag" : out.kind;
  const reading: TagReading = {
    kind,
    expiresOn: expiry ? isoDay(expiry.date) : null,
    lastInspectedOn: lastInspected ? isoDay(lastInspected.date) : null,
    servicedBy: out.servicedBy.trim() || null,
    confidence: out.confidence,
    notes: out.notes,
  };

  if (!out.isTagReadable) {
    return { created: false, reason: "unreadable", message: out.notes || "The tag could not be read in this photo. Take a closer, brighter one.", reading: null };
  }
  if (!expiry) {
    return {
      created: false,
      reason: "no_date",
      message: lastInspected
        ? "The tag shows when it was last inspected but no due date. Enter the expiry date."
        : "No expiry date could be made out on this tag. Enter it by hand.",
      reading,
    };
  }
  if (out.confidence < MIN_READ_CONFIDENCE) {
    return { created: false, reason: "low_confidence", message: "The date was too uncertain to save. Check it against the tag and enter it.", reading };
  }

  // The same tag photographed twice must not count down twice.
  const same = await prisma.expiryItem.findFirst({
    where: { assetId: asset.id, kind, expiresAt: expiry.date, status: ExpiryStatus.ACTIVE },
    select: { id: true },
  });
  if (same) {
    return { created: false, reason: "duplicate", message: "This one is already being tracked.", reading, existingId: same.id };
  }

  const item = await prisma.expiryItem.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: asset.propertyId,
      assetId: asset.id,
      kind,
      expiresAt: expiry.date,
      lastInspectedAt: lastInspected?.date ?? null,
      servicedBy: reading.servicedBy,
      notes: reading.notes || null,
      source: ExpirySource.AI_PHOTO,
      evidenceId: evidence.id,
      confidence: out.confidence,
      needsReview: true,
      createdById: ctx.userId,
    },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "expiry.read_from_photo",
    entityType: "ExpiryItem",
    entityId: item.id,
    metadata: { evidenceId: evidence.id, expiresAt: reading.expiresOn, confidence: out.confidence, precision: expiry.precision },
  });
  return { created: true, id: item.id, reading, alreadyExpired: expiry.date.getTime() < today.getTime() };
}
