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
