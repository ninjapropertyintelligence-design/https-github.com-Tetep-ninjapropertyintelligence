import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { normaliseArea, normaliseColor, pointProblem, type LngLat } from "@/lib/annotation-validation";
import type { SiteAnnotationKind } from "@/generated/prisma/client";

/**
 * Points and areas of interest on the site map. Marking up the site is
 * property set-up, so changing them is `canManageProperties`, like embeds and
 * overlays; seeing them follows the property.
 */

function requireManager(ctx: SessionContext) {
  if (!hasPermission(ctx.role, "canManageProperties")) {
    throw new ApiError(403, "Missing permission: canManageProperties");
  }
}

async function assertPropertyInScope(ctx: SessionContext, propertyId: string) {
  const property = await prisma.property.findFirst({ where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] }, select: { id: true } });
  if (!property) throw new ApiError(404, "Property not found");
}

export interface SiteAnnotationView {
  id: string;
  kind: SiteAnnotationKind;
  title: string;
  description: string | null;
  color: string;
  latitude: number | null;
  longitude: number | null;
  polygon: LngLat[] | null;
}

function toView(row: {
  id: string;
  kind: SiteAnnotationKind;
  title: string;
  description: string | null;
  color: string;
  latitude: number | null;
  longitude: number | null;
  polygon: unknown;
}): SiteAnnotationView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    color: row.color,
    latitude: row.latitude,
    longitude: row.longitude,
    polygon: Array.isArray(row.polygon) ? (row.polygon as LngLat[]) : null,
  };
}

export async function listAnnotations(ctx: SessionContext, propertyId: string): Promise<SiteAnnotationView[]> {
  await assertPropertyInScope(ctx, propertyId);
  const rows = await prisma.siteAnnotation.findMany({
    where: { propertyId, organizationId: ctx.organizationId },
    orderBy: [{ kind: "asc" }, { title: "asc" }],
  });
  return rows.map(toView);
}

export interface AnnotationInput {
  kind: SiteAnnotationKind;
  title: string;
  description?: string | null;
  color?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  polygon?: unknown;
}

/** The geometry columns for a kind, or a 400 naming what is wrong. */
function geometryFor(kind: SiteAnnotationKind, input: Pick<AnnotationInput, "latitude" | "longitude" | "polygon">) {
  if (kind === "POINT") {
    if (input.latitude == null || input.longitude == null) throw new ApiError(400, "A point needs a latitude and longitude");
    const problem = pointProblem(input.latitude, input.longitude);
    if (problem) throw new ApiError(400, problem);
    return { latitude: input.latitude, longitude: input.longitude, polygon: undefined };
  }
  const area = normaliseArea(input.polygon);
  if ("problem" in area) throw new ApiError(400, area.problem);
  return { latitude: null, longitude: null, polygon: area.ring };
}

function cleanTitle(raw: string) {
  const title = raw.trim();
  if (!title) throw new ApiError(400, "Give it a title");
  return title;
}

export async function createAnnotation(ctx: SessionContext, propertyId: string, input: AnnotationInput) {
  requireManager(ctx);
  await assertPropertyInScope(ctx, propertyId);
  const geometry = geometryFor(input.kind, input);
  const row = await prisma.siteAnnotation.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId,
      kind: input.kind,
      title: cleanTitle(input.title),
      description: input.description?.trim() || null,
      color: normaliseColor(input.color) ?? (input.kind === "AREA" ? "#16a34a" : "#22c55e"),
      latitude: geometry.latitude,
      longitude: geometry.longitude,
      ...(geometry.polygon ? { polygon: geometry.polygon } : {}),
      createdById: ctx.userId,
    },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "annotation.created",
    entityType: "SiteAnnotation",
    entityId: row.id,
    metadata: { kind: row.kind, propertyId },
  });
  return toView(row);
}

async function loadAnnotation(ctx: SessionContext, annotationId: string) {
  const row = await prisma.siteAnnotation.findFirst({
    where: { id: annotationId, organizationId: ctx.organizationId, property: propertyScopeWhere(ctx) },
  });
  if (!row) throw new ApiError(404, "Not found");
  return row;
}

export async function updateAnnotation(
  ctx: SessionContext,
  annotationId: string,
  input: Partial<Omit<AnnotationInput, "kind">>,
) {
  requireManager(ctx);
  const row = await loadAnnotation(ctx, annotationId);
  const movesGeometry = input.latitude !== undefined || input.longitude !== undefined || input.polygon !== undefined;
  const geometry = movesGeometry
    ? geometryFor(row.kind, {
        latitude: input.latitude ?? row.latitude,
        longitude: input.longitude ?? row.longitude,
        polygon: input.polygon ?? row.polygon,
      })
    : null;
  const updated = await prisma.siteAnnotation.update({
    where: { id: row.id },
    data: {
      ...(input.title !== undefined ? { title: cleanTitle(input.title) } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.color !== undefined ? { color: normaliseColor(input.color) ?? row.color } : {}),
      ...(geometry
        ? { latitude: geometry.latitude, longitude: geometry.longitude, ...(geometry.polygon ? { polygon: geometry.polygon } : {}) }
        : {}),
    },
  });
  return toView(updated);
}

export async function deleteAnnotation(ctx: SessionContext, annotationId: string) {
  requireManager(ctx);
  const row = await loadAnnotation(ctx, annotationId);
  await prisma.siteAnnotation.delete({ where: { id: row.id } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "annotation.deleted",
    entityType: "SiteAnnotation",
    entityId: row.id,
    metadata: { kind: row.kind, propertyId: row.propertyId },
  });
}
