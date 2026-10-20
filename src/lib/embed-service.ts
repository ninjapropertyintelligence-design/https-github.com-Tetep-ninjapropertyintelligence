import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission, ORG_WIDE_ROLES } from "@/lib/permissions";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { embedUrlProblem } from "@/lib/embed-url";
import type { SpatialEmbedKind } from "@/generated/prisma/client";

/**
 * 3D embeds and document flags. Both are property set-up, so both are
 * `canManageProperties`; seeing them follows the property.
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

export async function listEmbeds(ctx: SessionContext, propertyId: string) {
  await assertPropertyInScope(ctx, propertyId);
  return prisma.spatialEmbed.findMany({
    where: { propertyId, organizationId: ctx.organizationId },
    orderBy: [{ kind: "asc" }, { capturedAt: "desc" }, { name: "asc" }],
    include: { floor: { select: { id: true, name: true } } },
  });
}

export async function createEmbed(
  ctx: SessionContext,
  input: { propertyId: string; kind: SpatialEmbedKind; name: string; url: string; floorId?: string | null; capturedAt?: Date | null },
) {
  requireManager(ctx);
  await assertPropertyInScope(ctx, input.propertyId);
  const name = input.name.trim();
  if (!name) throw new ApiError(400, "An embed needs a name");
  const url = input.url.trim();
  const problem = embedUrlProblem(input.kind, url);
  if (problem) throw new ApiError(400, problem);
  if (input.floorId) {
    const floor = await prisma.floor.findFirst({ where: { id: input.floorId, building: { propertyId: input.propertyId } } });
    if (!floor) throw new ApiError(400, "That floor is not in this property");
  }
  const embed = await prisma.spatialEmbed.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: input.propertyId,
      kind: input.kind,
      name,
      url,
      floorId: input.floorId ?? null,
      capturedAt: input.capturedAt ?? null,
      createdById: ctx.userId,
    },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "embed.created",
    entityType: "SpatialEmbed",
    entityId: embed.id,
  });
  return embed;
}

export async function deleteEmbed(ctx: SessionContext, embedId: string) {
  requireManager(ctx);
  const embed = await prisma.spatialEmbed.findFirst({
    where: { id: embedId, organizationId: ctx.organizationId, property: propertyScopeWhere(ctx) },
  });
  if (!embed) throw new ApiError(404, "Embed not found");
  await prisma.spatialEmbed.delete({ where: { id: embed.id } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "embed.deleted",
    entityType: "SpatialEmbed",
    entityId: embed.id,
    metadata: { name: embed.name, propertyId: embed.propertyId },
  });
}

/** Where a property document shows up: the Overview's key documents, and the field's reference list. */
export async function setDocumentFlags(
  ctx: SessionContext,
  documentId: string,
  input: { showInInfoTab?: boolean; availableInCapture?: boolean },
) {
  requireManager(ctx);
  const document = await prisma.document.findFirst({ where: { id: documentId, organizationId: ctx.organizationId } });
  if (!document) throw new ApiError(404, "Document not found");
  // An organization-level document has no property to scope by; only
  // org-wide roles reach it, the same as reading it.
  if (document.propertyId) await assertPropertyInScope(ctx, document.propertyId);
  else if (!ORG_WIDE_ROLES.includes(ctx.role)) throw new ApiError(404, "Document not found");
  return prisma.document.update({
    where: { id: document.id },
    data: {
      ...(input.showInInfoTab !== undefined ? { showInInfoTab: input.showInInfoTab } : {}),
      ...(input.availableInCapture !== undefined ? { availableInCapture: input.availableInCapture } : {}),
    },
  });
}
