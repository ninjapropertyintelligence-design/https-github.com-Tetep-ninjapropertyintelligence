import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { Prisma, StorageObjectKind, type Evidence, type EvidenceType } from "@/generated/prisma/client";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { registerStorageObjectBestEffort } from "@/lib/storage-tiering";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { recordUsage } from "@/lib/cost-metering";
import { FEATURE_FLAGS, requireFeature } from "@/lib/feature-flags";

/**
 * Evidence registration.
 *
 * This lives in the service layer rather than in the route because two of the
 * things it does — the entitlement check and the usage meter — must hold on
 * every path that can create evidence, not only on the one HTTP handler that
 * happens to exist today. The same reasoning as tenant scope and as the
 * Matterport/drone gates.
 */

export interface CreateEvidenceInput {
  type: EvidenceType;
  storageKey: string;
  thumbnailKey?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  propertyId?: string | null;
  assetId?: string | null;
  issueId?: string | null;
  assessmentId?: string | null;
  captureDate?: Date | null;
  latitude?: number | null;
  longitude?: number | null;
  metadata?: Record<string, unknown>;
}

/**
 * Evidence types that are a *sellable capture kind* rather than an ordinary
 * attachment, and the flag each one is sold under.
 *
 * A plain PHOTO or DOCUMENT is part of every plan — gating those would stop
 * an inspector attaching a picture to an issue, which is the product's floor,
 * not an upsell. A 360 panorama is different: it is the third capture kind
 * alongside Matterport and drone, priced separately, and it is uploaded
 * through this same endpoint.
 */
const CAPTURE_KIND_FLAG: Partial<Record<EvidenceType, (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS]>> = {
  IMAGE_360: FEATURE_FLAGS.IMAGE_360,
};

export async function createEvidence(ctx: SessionContext, input: CreateEvidenceInput): Promise<Evidence> {
  // Gate BEFORE the property lookup so an organization that has not bought
  // 360 capture is told that, rather than being told its own property is
  // invalid.
  const flag = CAPTURE_KIND_FLAG[input.type];
  if (flag) await requireFeature(ctx, flag);

  if (input.propertyId) {
    const property = await prisma.property.findFirst({
      where: { AND: [{ id: input.propertyId }, propertyScopeWhere(ctx)] },
    });
    if (!property) throw new ApiError(400, "Invalid propertyId, or you don't have access to it");
  }

  const evidence = await prisma.evidence.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: input.propertyId ?? null,
      assetId: input.assetId ?? null,
      issueId: input.issueId ?? null,
      assessmentId: input.assessmentId ?? null,
      type: input.type,
      storageKey: input.storageKey,
      thumbnailKey: input.thumbnailKey ?? null,
      mimeType: input.mimeType ?? null,
      sizeBytes: input.sizeBytes ?? null,
      captureDate: input.captureDate ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      metadata: (input.metadata ?? {}) as unknown as Prisma.InputJsonValue,
      uploadedById: ctx.userId,
    },
  });

  await registerStorageObjectBestEffort({
    organizationId: ctx.organizationId,
    storageKey: evidence.storageKey,
    kind: StorageObjectKind.EVIDENCE,
    sizeBytes: evidence.sizeBytes === null ? null : Number(evidence.sizeBytes),
    objectCreatedAt: evidence.createdAt,
  });

  // Metered per panorama, not per byte: the bytes are already sampled into
  // GB-months by the storage meter, and counting them here too would bill the
  // same object twice under two names. What a 360 plan sells is the right to
  // capture panoramas.
  if (evidence.type === "IMAGE_360") {
    await recordUsage({
      organizationId: ctx.organizationId,
      propertyId: evidence.propertyId,
      metricType: "IMAGE_360_CAPTURE",
      quantity: 1,
      source: "evidence.create",
      metadata: { evidenceId: evidence.id },
    });
  }

  if (evidence.propertyId) {
    await emitEvent({
      organizationId: ctx.organizationId,
      propertyId: evidence.propertyId,
      type: EVENT_TYPES.EVIDENCE_UPLOADED,
      actorUserId: ctx.userId,
      payload: { evidenceId: evidence.id, type: evidence.type },
    });
  }

  return evidence;
}

/**
 * The most files one batch may carry.
 *
 * A drone flight is several hundred images, so registering them one HTTP call
 * at a time is the real blocker on subcontractor upload, not permissions. The
 * ceiling exists because `createMany` spends one bind parameter per column per
 * row and Postgres sends those with a 16-bit count — 500 rows of ~15 columns
 * is ~7,500, comfortably under the 65,535 limit with room for the shape to
 * grow.
 */
export const MAX_EVIDENCE_BATCH = 500;

/**
 * Registers many evidence files in one call.
 *
 * Not a loop over `createEvidence`: the entitlement check and the property
 * lookup happen once for the whole batch rather than once per file, which for
 * 500 drone images is the difference between two queries and a thousand.
 *
 * The batch is all-or-nothing on validation — one bad property id rejects the
 * call rather than registering 400 files and failing on the 401st, which
 * would leave the caller unable to tell what landed.
 */
export async function createEvidenceBatch(
  ctx: SessionContext,
  items: CreateEvidenceInput[],
): Promise<{ created: number; ids: string[] }> {
  if (items.length === 0) throw new ApiError(400, "No files to register");
  if (items.length > MAX_EVIDENCE_BATCH) {
    throw new ApiError(400, `A batch may carry at most ${MAX_EVIDENCE_BATCH} files; this one has ${items.length}`);
  }

  // Gate once, on the distinct capture kinds present.
  for (const type of new Set(items.map((i) => i.type))) {
    const flag = CAPTURE_KIND_FLAG[type];
    if (flag) await requireFeature(ctx, flag);
  }

  // Scope once, on the distinct properties present.
  const propertyIds = [...new Set(items.map((i) => i.propertyId).filter((id): id is string => !!id))];
  if (propertyIds.length > 0) {
    const allowed = await prisma.property.findMany({
      where: { AND: [{ id: { in: propertyIds } }, propertyScopeWhere(ctx)] },
      select: { id: true },
    });
    if (allowed.length !== propertyIds.length) {
      throw new ApiError(400, "One or more files name a property that does not exist, or that you can't access");
    }
  }

  const createdAt = new Date();
  await prisma.evidence.createMany({
    data: items.map((input) => ({
      organizationId: ctx.organizationId,
      propertyId: input.propertyId ?? null,
      assetId: input.assetId ?? null,
      issueId: input.issueId ?? null,
      assessmentId: input.assessmentId ?? null,
      type: input.type,
      storageKey: input.storageKey,
      thumbnailKey: input.thumbnailKey ?? null,
      mimeType: input.mimeType ?? null,
      sizeBytes: input.sizeBytes ?? null,
      captureDate: input.captureDate ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      metadata: (input.metadata ?? {}) as unknown as Prisma.InputJsonValue,
      uploadedById: ctx.userId,
      createdAt,
    })),
    // Re-uploading a manifest must not duplicate rows. The storage key carries
    // a UUID, so a genuine second file is never skipped by this.
    skipDuplicates: true,
  });

  const created = await prisma.evidence.findMany({
    where: { organizationId: ctx.organizationId, storageKey: { in: items.map((i) => i.storageKey) } },
    select: { id: true, storageKey: true, type: true, sizeBytes: true, propertyId: true, createdAt: true },
  });

  for (const row of created) {
    await registerStorageObjectBestEffort({
      organizationId: ctx.organizationId,
      storageKey: row.storageKey,
      kind: StorageObjectKind.EVIDENCE,
      sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
      objectCreatedAt: row.createdAt,
    });
  }

  // Metered per panorama here too. A bulk upload of 40 panoramas is 40
  // billable captures — charging once per batch would let a customer avoid
  // the meter by uploading in bigger batches.
  for (const row of created.filter((r) => r.type === "IMAGE_360")) {
    await recordUsage({
      organizationId: ctx.organizationId,
      propertyId: row.propertyId,
      metricType: "IMAGE_360_CAPTURE",
      quantity: 1,
      source: "evidence.batch",
      metadata: { evidenceId: row.id },
    });
  }

  // One event per property, not per file: 500 events would bury the property
  // history under a single upload.
  for (const propertyId of propertyIds) {
    await emitEvent({
      organizationId: ctx.organizationId,
      propertyId,
      type: EVENT_TYPES.EVIDENCE_UPLOADED,
      actorUserId: ctx.userId,
      payload: { count: created.filter((r) => r.propertyId === propertyId).length, batch: true },
    });
  }

  return { created: created.length, ids: created.map((r) => r.id) };
}
