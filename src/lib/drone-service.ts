import { prisma } from "@/lib/prisma";
import { SessionContext, propertyScopeWhere } from "@/lib/tenant-scope";
import { ApiError } from "@/lib/api-error";
import { getStorageProvider } from "@/lib/storage";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { writeAuditLog } from "@/lib/audit";
import { recalculatePropertyHealth } from "@/lib/scoring";
import { DroneOutputType } from "@/generated/prisma/client";
import { logEvent } from "@/lib/observability";

/**
 * Manual drone dataset import pipeline (spec Phase 2 §4-§6). No PIX4D
 * automation yet — this is the "make manual import perfect" workflow:
 * create a capture, upload raw images/outputs via signed direct-upload
 * URLs (never through the Next.js server), verify what actually landed in
 * storage (size + checksum), and associate everything with a Property.
 */

const ALLOWED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".tif", ".tiff"];
const ALLOWED_OUTPUT_EXTENSIONS_BY_TYPE: Record<DroneOutputType, string[]> = {
  PHOTO_SET: [".jpg", ".jpeg", ".png", ".zip"],
  ORTHOMOSAIC: [".tif", ".tiff", ".jpg", ".jpeg", ".png"],
  POINT_CLOUD: [".las", ".laz", ".ply", ".xyz"],
  MESH_3D: [".obj", ".glb", ".gltf", ".ply", ".fbx"],
  DSM: [".tif", ".tiff"],
  DTM: [".tif", ".tiff"],
};

function extensionOf(filenameOrKey: string): string {
  const match = filenameOrKey.match(/\.[a-zA-Z0-9]+$/);
  return match ? match[0].toLowerCase() : "";
}

async function assertPropertyInScope(ctx: SessionContext, propertyId: string) {
  const property = await prisma.property.findFirst({ where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] } });
  if (!property) throw new ApiError(404, "Property not found");
  return property;
}

async function loadScopedCapture(ctx: SessionContext, captureId: string) {
  const capture = await prisma.droneCapture.findFirst({
    where: { AND: [{ id: captureId }, { property: propertyScopeWhere(ctx) }] },
  });
  if (!capture) throw new ApiError(404, "Drone capture not found");
  return capture;
}

async function loadScopedDataset(ctx: SessionContext, datasetId: string) {
  const dataset = await prisma.droneDataset.findFirst({
    where: { id: datasetId, capture: { property: propertyScopeWhere(ctx) } },
    include: { capture: true },
  });
  if (!dataset) throw new ApiError(404, "Drone dataset not found");
  return dataset;
}

export async function createDroneCapture(
  ctx: SessionContext,
  propertyId: string,
  input: { capturedAt?: Date; droneModel?: string; notes?: string },
) {
  const property = await assertPropertyInScope(ctx, propertyId);
  const capture = await prisma.droneCapture.create({
    data: {
      propertyId: property.id,
      capturedById: ctx.userId,
      capturedAt: input.capturedAt ?? new Date(),
      droneModel: input.droneModel,
      notes: input.notes,
      status: "CREATED",
    },
  });
  await Promise.all([
    emitEvent({
      organizationId: ctx.organizationId,
      propertyId: property.id,
      type: EVENT_TYPES.CAPTURE_CREATED,
      actorUserId: ctx.userId,
      payload: { captureId: capture.id, droneModel: input.droneModel },
    }),
    writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "drone.capture_created",
      entityType: "DroneCapture",
      entityId: capture.id,
    }),
  ]);
  return capture;
}

export async function createDroneDataset(ctx: SessionContext, captureId: string) {
  const capture = await loadScopedCapture(ctx, captureId);
  await prisma.droneCapture.update({ where: { id: capture.id }, data: { status: "UPLOADING" } });
  return prisma.droneDataset.create({ data: { captureId: capture.id, provider: "MANUAL" } });
}

async function verifyUploadedFile(ctx: SessionContext, params: {
  storageKey: string;
  clientSizeBytes?: number;
  clientChecksum?: string;
}) {
  try {
    const verification = await getStorageProvider().verifyUpload(params.storageKey);
    if (!verification.exists) {
      throw new ApiError(400, "No file was found at the given storage key — upload it before registering metadata");
    }
    if (params.clientSizeBytes !== undefined && verification.actualSizeBytes !== params.clientSizeBytes) {
      throw new ApiError(
        400,
        `Uploaded file size (${verification.actualSizeBytes} bytes) doesn't match the reported size (${params.clientSizeBytes} bytes)`,
      );
    }
    if (params.clientChecksum && verification.actualChecksumSha256 !== params.clientChecksum.toLowerCase()) {
      throw new ApiError(400, "Uploaded file checksum doesn't match the reported checksum — upload may be corrupted");
    }
    logEvent("drone.upload", { ok: true, organizationId: ctx.organizationId, sizeBytes: verification.actualSizeBytes ?? undefined });
    return verification;
  } catch (err) {
    logEvent("drone.upload", {
      ok: false,
      organizationId: ctx.organizationId,
      sizeBytes: params.clientSizeBytes,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function registerDroneImage(
  ctx: SessionContext,
  datasetId: string,
  input: {
    storageKey: string;
    thumbnailKey?: string;
    mimeType?: string;
    sizeBytes?: number;
    checksum?: string;
    latitude?: number;
    longitude?: number;
    altitude?: number;
    capturedAt?: Date;
  },
) {
  const dataset = await loadScopedDataset(ctx, datasetId);

  const ext = extensionOf(input.storageKey);
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
    throw new ApiError(400, `Unsupported image file type "${ext || "unknown"}" — allowed: ${ALLOWED_IMAGE_EXTENSIONS.join(", ")}`);
  }

  const verification = await verifyUploadedFile(ctx, {
    storageKey: input.storageKey,
    clientSizeBytes: input.sizeBytes,
    clientChecksum: input.checksum,
  });

  return prisma.droneImage.create({
    data: {
      datasetId: dataset.id,
      storageKey: input.storageKey,
      thumbnailKey: input.thumbnailKey,
      mimeType: input.mimeType ?? null,
      sizeBytes: verification.actualSizeBytes,
      checksum: verification.actualChecksumSha256,
      latitude: input.latitude,
      longitude: input.longitude,
      altitude: input.altitude,
      capturedAt: input.capturedAt,
    },
  });
}

export async function registerDroneOutput(
  ctx: SessionContext,
  datasetId: string,
  input: {
    outputType: DroneOutputType;
    storageKey: string;
    mimeType?: string;
    sizeBytes?: number;
    checksum?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const dataset = await loadScopedDataset(ctx, datasetId);

  const ext = extensionOf(input.storageKey);
  const allowed = ALLOWED_OUTPUT_EXTENSIONS_BY_TYPE[input.outputType];
  if (!allowed.includes(ext)) {
    throw new ApiError(400, `Unsupported file type "${ext || "unknown"}" for output type ${input.outputType} — allowed: ${allowed.join(", ")}`);
  }

  const verification = await verifyUploadedFile(ctx, {
    storageKey: input.storageKey,
    clientSizeBytes: input.sizeBytes,
    clientChecksum: input.checksum,
  });

  const output = await prisma.droneOutput.create({
    data: {
      datasetId: dataset.id,
      outputType: input.outputType,
      storageKey: input.storageKey,
      mimeType: input.mimeType ?? null,
      sizeBytes: verification.actualSizeBytes,
      checksum: verification.actualChecksumSha256,
      metadata: (input.metadata ?? {}) as never,
    },
  });

  return output;
}

/** Marks a capture READY once review is complete (spec §4: "Review Dataset -> Display Exterior"). */
export async function markCaptureReady(ctx: SessionContext, captureId: string) {
  const capture = await loadScopedCapture(ctx, captureId);
  const updated = await prisma.droneCapture.update({ where: { id: capture.id }, data: { status: "READY" } });

  await Promise.all([
    emitEvent({
      organizationId: ctx.organizationId,
      propertyId: capture.propertyId,
      type: EVENT_TYPES.CAPTURE_PROCESSING_COMPLETED,
      actorUserId: ctx.userId,
      payload: { captureId: capture.id },
    }),
    recalculatePropertyHealth(capture.propertyId),
  ]);

  return updated;
}

export async function markCaptureFailed(ctx: SessionContext, captureId: string, errorMessage: string) {
  const capture = await loadScopedCapture(ctx, captureId);
  const updated = await prisma.droneCapture.update({ where: { id: capture.id }, data: { status: "FAILED", notes: errorMessage } });
  await emitEvent({
    organizationId: ctx.organizationId,
    propertyId: capture.propertyId,
    type: EVENT_TYPES.CAPTURE_PROCESSING_FAILED,
    actorUserId: ctx.userId,
    payload: { captureId: capture.id, error: errorMessage },
  });
  return updated;
}

/** Full exterior dataset for the Exterior tab: captures, datasets, images, outputs, markers. */
export async function getPropertyExteriorData(ctx: SessionContext, propertyId: string) {
  const property = await assertPropertyInScope(ctx, propertyId);
  const captures = await prisma.droneCapture.findMany({
    where: { propertyId: property.id },
    orderBy: { createdAt: "desc" },
    include: {
      datasets: {
        include: {
          images: { orderBy: { createdAt: "asc" }, take: 100 },
          outputs: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });

  const storage = getStorageProvider();
  const capturesWithUrls = await Promise.all(
    captures.map(async (capture) => ({
      ...capture,
      datasets: await Promise.all(
        capture.datasets.map(async (dataset) => ({
          ...dataset,
          images: await Promise.all(dataset.images.map(async (img) => ({ ...img, downloadUrl: await storage.getDownloadUrl(img.storageKey) }))),
          outputs: await Promise.all(dataset.outputs.map(async (out) => ({ ...out, downloadUrl: await storage.getDownloadUrl(out.storageKey) }))),
        })),
      ),
    })),
  );

  const markers = await prisma.exteriorMarker.findMany({
    where: { propertyId: property.id },
    include: {
      asset: { select: { id: true, name: true } },
      issue: { select: { id: true, title: true, severity: true } },
      evidence: { select: { id: true, type: true } },
    },
  });
  return { captures: capturesWithUrls, markers };
}
