import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { getStorageProvider } from "@/lib/storage";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import {
  boundsProblem,
  MAX_RASTER_BYTES,
  MAX_VECTOR_BYTES,
  parseGeoJson,
  RASTER_MIME_TYPES,
} from "@/lib/overlay-validation";
import type { OverlayCategory, OverlayKind } from "@/generated/prisma/client";

/**
 * Map overlays: plan sheets and aerials laid over a property's site map, and
 * GeoJSON drawn on it.
 *
 * Seeing them follows the property. Adding or changing them is
 * `canManageProperties` — a wrong plan laid over the wrong building is read
 * as fact by everyone who opens the map.
 */

function requireManager(ctx: SessionContext) {
  if (!hasPermission(ctx.role, "canManageProperties")) {
    throw new ApiError(403, "Missing permission: canManageProperties");
  }
}

async function assertPropertyInScope(ctx: SessionContext, propertyId: string) {
  const property = await prisma.property.findFirst({
    where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] },
    select: { id: true },
  });
  if (!property) throw new ApiError(404, "Property not found");
}

async function loadOverlay(ctx: SessionContext, overlayId: string) {
  const overlay = await prisma.propertyOverlay.findFirst({
    where: { id: overlayId, organizationId: ctx.organizationId, property: propertyScopeWhere(ctx) },
  });
  if (!overlay) throw new ApiError(404, "Overlay not found");
  return overlay;
}

export async function listOverlays(ctx: SessionContext, propertyId: string) {
  await assertPropertyInScope(ctx, propertyId);
  return prisma.propertyOverlay.findMany({
    where: { propertyId, organizationId: ctx.organizationId },
    orderBy: [{ kind: "asc" }, { isDefault: "desc" }, { category: "asc" }, { name: "asc" }],
    include: { floor: { select: { id: true, name: true } } },
  });
}

export interface CreateOverlayInput {
  propertyId: string;
  kind: OverlayKind;
  category?: OverlayCategory;
  name: string;
  storageKey: string;
  mimeType: string;
  floorId?: string | null;
  north?: number | null;
  south?: number | null;
  east?: number | null;
  west?: number | null;
  defaultOpacity?: number;
  isDefault?: boolean;
  capturedAt?: Date | null;
}

export async function createOverlay(ctx: SessionContext, input: CreateOverlayInput) {
  requireManager(ctx);
  await assertPropertyInScope(ctx, input.propertyId);
  const name = input.name.trim();
  if (!name) throw new ApiError(400, "An overlay needs a name");

  // Upload keys are minted under the organization's prefix. A key outside it
  // is another tenant's object, and registering it here would serve that
  // object's bytes through this organization's map.
  if (!input.storageKey.startsWith(`${ctx.organizationId}/`)) {
    throw new ApiError(400, "That file was not uploaded to this organization");
  }

  if (input.floorId) {
    const floor = await prisma.floor.findFirst({ where: { id: input.floorId, building: { propertyId: input.propertyId } } });
    if (!floor) throw new ApiError(400, "That floor is not in this property");
  }

  const bytes = await getStorageProvider().readBytes(input.storageKey);
  if (!bytes) throw new ApiError(400, "The uploaded file was not found in storage — upload it again");

  let bounds: { north: number | null; south: number | null; east: number | null; west: number | null } = {
    north: null,
    south: null,
    east: null,
    west: null,
  };
  if (input.kind === "RASTER") {
    if (!(RASTER_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
      throw new ApiError(400, "A raster overlay must be a PNG, JPEG or WebP image");
    }
    if (bytes.byteLength > MAX_RASTER_BYTES) throw new ApiError(400, "That image is larger than 40 MB");
    const problem = boundsProblem(input as Parameters<typeof boundsProblem>[0]);
    if (problem) throw new ApiError(400, problem);
    bounds = { north: input.north!, south: input.south!, east: input.east!, west: input.west! };
  } else {
    if (bytes.byteLength > MAX_VECTOR_BYTES) throw new ApiError(400, "That GeoJSON file is larger than 5 MB");
    const parsed = parseGeoJson(bytes.toString("utf8"));
    if (!parsed.ok) throw new ApiError(400, parsed.problem);
  }

  const overlay = await prisma.propertyOverlay.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: input.propertyId,
      floorId: input.floorId ?? null,
      kind: input.kind,
      category: input.category ?? (input.kind === "RASTER" ? "AERIAL" : "OTHER"),
      name,
      storageKey: input.storageKey,
      mimeType: input.kind === "VECTOR" ? "application/geo+json" : input.mimeType,
      sizeBytes: bytes.byteLength,
      ...bounds,
      defaultOpacity: clampOpacity(input.defaultOpacity ?? 0.8),
      isDefault: input.isDefault ?? false,
      capturedAt: input.capturedAt ?? null,
      createdById: ctx.userId,
    },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "overlay.created",
    entityType: "PropertyOverlay",
    entityId: overlay.id,
  });
  return overlay;
}

function clampOpacity(value: number) {
  return Math.min(1, Math.max(0, value));
}

export async function updateOverlay(
  ctx: SessionContext,
  overlayId: string,
  input: Partial<Pick<CreateOverlayInput, "name" | "category" | "defaultOpacity" | "isDefault" | "capturedAt" | "north" | "south" | "east" | "west">>,
) {
  requireManager(ctx);
  const overlay = await loadOverlay(ctx, overlayId);
  if (input.name !== undefined && !input.name.trim()) throw new ApiError(400, "An overlay needs a name");

  const movesEdges = ["north", "south", "east", "west"].some((k) => input[k as keyof typeof input] !== undefined);
  if (movesEdges) {
    if (overlay.kind !== "RASTER") throw new ApiError(400, "Only a raster overlay has edges");
    const next = {
      north: input.north ?? overlay.north ?? undefined,
      south: input.south ?? overlay.south ?? undefined,
      east: input.east ?? overlay.east ?? undefined,
      west: input.west ?? overlay.west ?? undefined,
    };
    const problem = boundsProblem(next);
    if (problem) throw new ApiError(400, problem);
  }

  return prisma.propertyOverlay.update({
    where: { id: overlay.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.defaultOpacity !== undefined ? { defaultOpacity: clampOpacity(input.defaultOpacity) } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
      ...(movesEdges
        ? { north: input.north ?? overlay.north, south: input.south ?? overlay.south, east: input.east ?? overlay.east, west: input.west ?? overlay.west }
        : {}),
    },
  });
}

/** Removes an overlay and its file. The file goes too: nothing else points at it. */
export async function deleteOverlay(ctx: SessionContext, overlayId: string) {
  requireManager(ctx);
  const overlay = await loadOverlay(ctx, overlayId);
  await prisma.propertyOverlay.delete({ where: { id: overlay.id } });
  await getStorageProvider()
    .delete(overlay.storageKey)
    .catch(() => {
      // The row is gone, which is what the person asked for. An orphaned
      // object is a storage-cost problem the tiering sweep can find, not a
      // reason to tell them the delete failed.
    });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "overlay.deleted",
    entityType: "PropertyOverlay",
    entityId: overlay.id,
    metadata: { name: overlay.name, propertyId: overlay.propertyId },
  });
}

/** The overlay's bytes, for the same-origin content route Mapbox loads it from. */
export async function readOverlayContent(ctx: SessionContext, overlayId: string) {
  const overlay = await loadOverlay(ctx, overlayId);
  const bytes = await getStorageProvider().readBytes(overlay.storageKey);
  if (!bytes) throw new ApiError(404, "This overlay's file is no longer present in storage");
  return { bytes, mimeType: overlay.mimeType };
}
