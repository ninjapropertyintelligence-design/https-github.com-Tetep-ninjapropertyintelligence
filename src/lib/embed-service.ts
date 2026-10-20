import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission, ORG_WIDE_ROLES } from "@/lib/permissions";
import { captureReviewWhere, propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { embedUrlProblem, matterportShowUrl } from "@/lib/embed-url";
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

async function loadEmbed(ctx: SessionContext, embedId: string) {
  const embed = await prisma.spatialEmbed.findFirst({
    where: { id: embedId, organizationId: ctx.organizationId, property: propertyScopeWhere(ctx) },
  });
  if (!embed) throw new ApiError(404, "Embed not found");
  return embed;
}

export async function updateEmbed(
  ctx: SessionContext,
  embedId: string,
  input: { kind?: SpatialEmbedKind; name?: string; url?: string; floorId?: string | null; capturedAt?: Date | null },
) {
  requireManager(ctx);
  const embed = await loadEmbed(ctx, embedId);
  if (input.name !== undefined && !input.name.trim()) throw new ApiError(400, "An embed needs a name");
  // Checked against the kind it will have afterwards: changing a point cloud
  // to "Matterport tour" must not keep a link that is not a Matterport one.
  const kind = input.kind ?? embed.kind;
  const url = input.url?.trim() ?? embed.url;
  if (input.kind !== undefined || input.url !== undefined) {
    const problem = embedUrlProblem(kind, url);
    if (problem) throw new ApiError(400, problem);
  }
  if (input.floorId) {
    const floor = await prisma.floor.findFirst({ where: { id: input.floorId, building: { propertyId: embed.propertyId } } });
    if (!floor) throw new ApiError(400, "That floor is not in this property");
  }
  return prisma.spatialEmbed.update({
    where: { id: embed.id },
    data: {
      kind,
      url,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.floorId !== undefined ? { floorId: input.floorId } : {}),
      ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
    },
  });
}

/**
 * Matterport spaces linked to this property through the Matterport
 * connection, as viewer links. Read-only here: they are linked and unlinked
 * on the Interior tab, which owns them. Vendor-delivered links still under
 * review stay hidden, the same as everywhere else they appear.
 */
export async function listConnectedTours(ctx: SessionContext, propertyId: string) {
  await assertPropertyInScope(ctx, propertyId);
  const links = await prisma.matterportPropertyLink.findMany({
    where: { propertyId, ...captureReviewWhere(ctx) },
    orderBy: { linkedAt: "desc" },
    include: { space: { select: { externalSpaceId: true, name: true, capturedAt: true } } },
  });
  return links.flatMap((link) => {
    const url = matterportShowUrl(link.space.externalSpaceId);
    // A space id that cannot be a Matterport model id is not turned into a
    // link at all, rather than into a frame that loads someone else's page.
    if (!url) return [];
    return [{ id: link.id, name: link.space.name ?? "Matterport tour", url, capturedAt: link.space.capturedAt, linkedAt: link.linkedAt }];
  });
}

export async function deleteEmbed(ctx: SessionContext, embedId: string) {
  requireManager(ctx);
  const embed = await loadEmbed(ctx, embedId);
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
