import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { hasPermission } from "@/lib/permissions";
import { evidenceScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import type { CollectionVisibility, Prisma } from "@/generated/prisma/client";

/**
 * Collections: hand-picked sets of photos.
 *
 * A collection is private to its maker or shared with the organization. A
 * shared collection is a list of pointers, not a grant: each viewer sees only
 * the items on properties they can already open, so sharing "roof damage
 * across the region" with a store manager does not show them other stores.
 *
 * Making one needs `canViewPortfolio` — it is a bookmark over what you can
 * already see. Only its maker changes it.
 */

export const COLLECTION_SORTS = ["recent", "name", "items"] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

function visibleCollectionWhere(ctx: SessionContext): Prisma.CollectionWhereInput {
  return {
    organizationId: ctx.organizationId,
    OR: [{ visibility: "ORGANIZATION" }, { createdById: ctx.userId }],
  };
}

function requireViewer(ctx: SessionContext) {
  if (!hasPermission(ctx.role, "canViewPortfolio")) {
    throw new ApiError(403, "Missing permission: canViewPortfolio");
  }
}

async function loadVisible(ctx: SessionContext, collectionId: string) {
  const collection = await prisma.collection.findFirst({ where: { AND: [{ id: collectionId }, visibleCollectionWhere(ctx)] } });
  if (!collection) throw new ApiError(404, "Collection not found");
  return collection;
}

async function loadOwn(ctx: SessionContext, collectionId: string) {
  const collection = await loadVisible(ctx, collectionId);
  if (collection.createdById !== ctx.userId) throw new ApiError(403, "Only the person who made this collection can change it");
  return collection;
}

export interface CollectionFilters {
  q?: string | null;
  visibility?: CollectionVisibility | null;
  /** "me": only mine; otherwise anyone's that I can see. */
  creator?: "me" | null;
  sort?: CollectionSort | null;
}

export async function listCollections(ctx: SessionContext, filters: CollectionFilters = {}) {
  const rows = await prisma.collection.findMany({
    where: {
      AND: [
        visibleCollectionWhere(ctx),
        filters.visibility ? { visibility: filters.visibility } : {},
        filters.creator === "me" ? { createdById: ctx.userId } : {},
        filters.q ? { name: { contains: filters.q, mode: "insensitive" } } : {},
      ],
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      // Counted through scope, so the number on the card is the number the
      // viewer will actually find inside.
      _count: { select: { items: { where: { evidence: evidenceScopeWhere(ctx) } } } },
      items: {
        where: { evidence: evidenceScopeWhere(ctx) },
        orderBy: { addedAt: "desc" },
        take: 1,
        select: { evidenceId: true },
      },
    },
    orderBy: filters.sort === "name" ? { name: "asc" } : { updatedAt: "desc" },
    take: 200,
  });
  if (filters.sort === "items") rows.sort((a, b) => b._count.items - a._count.items);
  return rows.map(({ items, ...c }) => ({ ...c, coverEvidenceId: items[0]?.evidenceId ?? null }));
}

export async function getCollection(ctx: SessionContext, collectionId: string) {
  const collection = await loadVisible(ctx, collectionId);
  const [createdBy, items] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: collection.createdById }, select: { id: true, name: true } }),
    prisma.collectionItem.findMany({
      where: { collectionId: collection.id, evidence: evidenceScopeWhere(ctx) },
      orderBy: { addedAt: "desc" },
      include: {
        evidence: {
          select: { id: true, type: true, captureDate: true, createdAt: true, property: { select: { id: true, name: true } } },
        },
      },
    }),
  ]);
  return { ...collection, createdBy, items, canEdit: collection.createdById === ctx.userId };
}

export async function createCollection(
  ctx: SessionContext,
  input: { name: string; description?: string | null; visibility?: CollectionVisibility },
) {
  requireViewer(ctx);
  const name = input.name.trim();
  if (!name) throw new ApiError(400, "A collection needs a name");
  return prisma.collection.create({
    data: {
      organizationId: ctx.organizationId,
      name,
      description: input.description?.trim() || null,
      visibility: input.visibility ?? "PRIVATE",
      createdById: ctx.userId,
    },
  });
}

export async function updateCollection(
  ctx: SessionContext,
  collectionId: string,
  input: { name?: string; description?: string | null; visibility?: CollectionVisibility },
) {
  const collection = await loadOwn(ctx, collectionId);
  if (input.name !== undefined && !input.name.trim()) throw new ApiError(400, "A collection needs a name");
  return prisma.collection.update({
    where: { id: collection.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    },
  });
}

/** Deletes the collection. The photos stay where they are; only the list goes. */
export async function deleteCollection(ctx: SessionContext, collectionId: string) {
  const collection = await loadOwn(ctx, collectionId);
  await prisma.collection.delete({ where: { id: collection.id } });
}

/** Adds files the caller can see. Already-collected ones are skipped, not an error. */
export async function addToCollection(ctx: SessionContext, collectionId: string, evidenceIds: string[]) {
  const collection = await loadOwn(ctx, collectionId);
  const ids = [...new Set(evidenceIds)];
  if (ids.length === 0) throw new ApiError(400, "Nothing to add");
  const visible = await prisma.evidence.findMany({
    where: { AND: [{ id: { in: ids } }, evidenceScopeWhere(ctx)] },
    select: { id: true },
  });
  if (visible.length !== ids.length) throw new ApiError(400, "One or more files do not exist, or you can't access them");
  const result = await prisma.collectionItem.createMany({
    data: ids.map((evidenceId) => ({ collectionId: collection.id, evidenceId, addedById: ctx.userId })),
    skipDuplicates: true,
  });
  await prisma.collection.update({ where: { id: collection.id }, data: { updatedAt: new Date() } });
  return { added: result.count };
}

export async function removeFromCollection(ctx: SessionContext, collectionId: string, evidenceId: string) {
  const collection = await loadOwn(ctx, collectionId);
  await prisma.collectionItem.deleteMany({ where: { collectionId: collection.id, evidenceId } });
}

/** The caller's own collections, for an "add to collection" menu. */
export async function myCollections(ctx: SessionContext) {
  return prisma.collection.findMany({
    where: { organizationId: ctx.organizationId, createdById: ctx.userId },
    select: { id: true, name: true },
    orderBy: { updatedAt: "desc" },
  });
}
