import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { evidenceScopeWhere, propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The organization's tag vocabulary — Level, Area, Type, Category and its
 * own — and tagging photos and task responses with it.
 *
 * Defining the vocabulary is `canManageProperties`: it is how everyone's
 * media is filed. Tagging is anyone who may write that photo or response.
 * A value is organization-wide, or offered only at one property; a value
 * from another property can never be put on a photo, or a "Mezzanine" tag
 * would leak into buildings that have none.
 */

/** What an organization starts with, matching how field teams usually file photos. */
export const STANDARD_TAG_TYPES: Array<{ name: string; values: string[]; allowMultiple?: boolean }> = [
  { name: "Level", values: ["Ground", "Level 1", "Roof", "Aerial"] },
  { name: "Area", values: ["Interior", "Exterior"] },
  { name: "Type", values: ["Inspection", "Survey", "Repair", "Delivery"] },
  { name: "Category", values: ["HVAC", "Electrical", "Plumbing", "Roof", "Fire & Life Safety", "Lighting", "Signage", "Parking"] },
  { name: "Tag", values: [], allowMultiple: true },
];

function requireVocabularyManager(ctx: SessionContext) {
  if (!hasPermission(ctx.role, "canManageProperties")) {
    throw new ApiError(403, "Missing permission: canManageProperties");
  }
}

const tidy = (name: string, what: string) => {
  const value = name.trim().replace(/\s+/g, " ");
  if (!value) throw new ApiError(400, `A ${what} needs a name`);
  if (value.length > 100) throw new ApiError(400, `A ${what} name is at most 100 characters`);
  return value;
};

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type Vocabulary = Awaited<ReturnType<typeof getVocabulary>>;

/**
 * The tag types and the values offered at one property (organization-wide
 * values plus that property's own), or organization-wide values only when
 * no property is given.
 */
export async function getVocabulary(ctx: SessionContext, propertyId?: string | null) {
  if (propertyId) {
    const visible = await prisma.property.findFirst({ where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] }, select: { id: true } });
    if (!visible) throw new ApiError(404, "Property not found");
  }
  return prisma.tagType.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: {
      values: {
        where: { OR: [{ propertyId: null }, ...(propertyId ? [{ propertyId }] : [])] },
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: { id: true, name: true, propertyId: true },
      },
    },
  });
}

/** Adds the standard types and values the organization does not have yet. */
export async function addStandardTagTypes(ctx: SessionContext) {
  requireVocabularyManager(ctx);
  const existing = await prisma.tagType.findMany({ where: { organizationId: ctx.organizationId }, include: { values: { where: { propertyId: null } } } });
  for (const [index, standard] of STANDARD_TAG_TYPES.entries()) {
    const type =
      existing.find((t) => t.name.toLowerCase() === standard.name.toLowerCase()) ??
      (await prisma.tagType.create({
        data: { organizationId: ctx.organizationId, name: standard.name, position: index, allowMultiple: standard.allowMultiple ?? false },
        include: { values: true },
      }));
    const have = new Set(type.values.map((v) => v.name.toLowerCase()));
    const missing = standard.values.filter((v) => !have.has(v.toLowerCase()));
    if (missing.length > 0) {
      await prisma.tagValue.createMany({
        data: missing.map((name, i) => ({ organizationId: ctx.organizationId, tagTypeId: type.id, name, position: type.values.length + i })),
      });
    }
  }
  return getVocabulary(ctx);
}

export async function createTagType(ctx: SessionContext, input: { name: string; allowMultiple?: boolean }) {
  requireVocabularyManager(ctx);
  const name = tidy(input.name, "tag type");
  const clash = await prisma.tagType.findFirst({ where: { organizationId: ctx.organizationId, name: { equals: name, mode: "insensitive" } } });
  if (clash) throw new ApiError(409, `A tag type named "${clash.name}" already exists`);
  const count = await prisma.tagType.count({ where: { organizationId: ctx.organizationId } });
  return prisma.tagType.create({
    data: { organizationId: ctx.organizationId, name, position: count, allowMultiple: input.allowMultiple ?? false },
  });
}

async function loadType(ctx: SessionContext, tagTypeId: string) {
  const type = await prisma.tagType.findFirst({ where: { id: tagTypeId, organizationId: ctx.organizationId } });
  if (!type) throw new ApiError(404, "Tag type not found");
  return type;
}

/**
 * Deleting a type or value removes it from every photo and response that
 * carried it, so the caller is told how many first and must confirm.
 */
export async function tagUsage(ctx: SessionContext, input: { tagTypeId?: string; tagValueId?: string }) {
  const where: Prisma.TagValueWhereInput = { organizationId: ctx.organizationId, ...(input.tagValueId ? { id: input.tagValueId } : { tagTypeId: input.tagTypeId }) };
  const [photos, responses] = await Promise.all([
    prisma.evidenceTag.count({ where: { tagValue: where } }),
    prisma.taskResponseTag.count({ where: { tagValue: where } }),
  ]);
  return { photos, responses };
}

export async function deleteTagType(ctx: SessionContext, tagTypeId: string) {
  requireVocabularyManager(ctx);
  const type = await loadType(ctx, tagTypeId);
  const usage = await tagUsage(ctx, { tagTypeId: type.id });
  await prisma.tagType.delete({ where: { id: type.id } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "tag_type.deleted",
    entityType: "TagType",
    entityId: type.id,
    metadata: { name: type.name, ...usage },
  });
  return usage;
}

export async function createTagValue(ctx: SessionContext, input: { tagTypeId: string; name: string; propertyId?: string | null }) {
  requireVocabularyManager(ctx);
  const type = await loadType(ctx, input.tagTypeId);
  const name = tidy(input.name, "tag");
  if (input.propertyId) {
    const visible = await prisma.property.findFirst({ where: { AND: [{ id: input.propertyId }, propertyScopeWhere(ctx)] }, select: { id: true } });
    if (!visible) throw new ApiError(400, "Invalid propertyId, or you don't have access to it");
  }
  // Unique by name among the values offered in the same place: an
  // organization-wide "Roof" and a property's own "Roof" would be two
  // filter entries that mean the same thing.
  const clash = await prisma.tagValue.findFirst({
    where: {
      tagTypeId: type.id,
      name: { equals: name, mode: "insensitive" },
      OR: [{ propertyId: null }, ...(input.propertyId ? [{ propertyId: input.propertyId }] : [])],
    },
  });
  if (clash) throw new ApiError(409, `"${clash.name}" already exists under ${type.name}`);
  const count = await prisma.tagValue.count({ where: { tagTypeId: type.id } });
  return prisma.tagValue.create({
    data: { organizationId: ctx.organizationId, tagTypeId: type.id, propertyId: input.propertyId ?? null, name, position: count },
  });
}

export async function deleteTagValue(ctx: SessionContext, tagValueId: string) {
  requireVocabularyManager(ctx);
  const value = await prisma.tagValue.findFirst({ where: { id: tagValueId, organizationId: ctx.organizationId } });
  if (!value) throw new ApiError(404, "Tag not found");
  const usage = await tagUsage(ctx, { tagValueId: value.id });
  await prisma.tagValue.delete({ where: { id: value.id } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "tag_value.deleted",
    entityType: "TagValue",
    entityId: value.id,
    metadata: { name: value.name, ...usage },
  });
  return usage;
}

// ---------------------------------------------------------------------------
// Applying tags
// ---------------------------------------------------------------------------

/**
 * Checks a set of tag values for one item at one property: every value is
 * this organization's, offered there, and at most one per single-value type.
 */
export async function resolveTagValues(organizationId: string, propertyId: string | null, tagValueIds: string[]) {
  const ids = [...new Set(tagValueIds)];
  if (ids.length === 0) return [];
  const values = await prisma.tagValue.findMany({
    where: { id: { in: ids }, organizationId },
    include: { tagType: { select: { id: true, name: true, allowMultiple: true } } },
  });
  if (values.length !== ids.length) throw new ApiError(400, "One or more tags do not exist");
  const elsewhere = values.find((v) => v.propertyId !== null && v.propertyId !== propertyId);
  if (elsewhere) throw new ApiError(400, `"${elsewhere.name}" is a tag for a different property`);
  const perType = new Map<string, number>();
  for (const v of values) perType.set(v.tagType.id, (perType.get(v.tagType.id) ?? 0) + 1);
  const crowded = values.find((v) => !v.tagType.allowMultiple && (perType.get(v.tagType.id) ?? 0) > 1);
  if (crowded) throw new ApiError(400, `Choose one ${crowded.tagType.name}, not several`);
  return values;
}

/** Replaces a photo's tags. Anyone who may upload evidence and can see the photo. */
export async function setEvidenceTags(ctx: SessionContext, evidenceId: string, tagValueIds: string[]) {
  if (!hasPermission(ctx.role, "canUploadEvidence")) throw new ApiError(403, "Missing permission: canUploadEvidence");
  const evidence = await loadVisibleEvidence(ctx, evidenceId);
  const values = await resolveTagValues(ctx.organizationId, evidence.propertyId, tagValueIds);
  await prisma.$transaction([
    prisma.evidenceTag.deleteMany({ where: { evidenceId: evidence.id } }),
    prisma.evidenceTag.createMany({ data: values.map((v) => ({ evidenceId: evidence.id, tagValueId: v.id })) }),
  ]);
  return values.map((v) => v.id);
}

async function loadVisibleEvidence(ctx: SessionContext, evidenceId: string) {
  const evidence = await prisma.evidence.findFirst({ where: { AND: [{ id: evidenceId }, evidenceScopeWhere(ctx)] } });
  if (!evidence) throw new ApiError(404, "Photo not found");
  return evidence;
}

/** Copies a template task's default tags onto a new response of it. */
export async function applyTaskDefaultTags(taskResponseId: string, taskId: string, propertyId: string) {
  const defaults = await prisma.assessmentTaskDefaultTag.findMany({
    where: { taskId, tagValue: { OR: [{ propertyId: null }, { propertyId }] } },
    select: { tagValueId: true },
  });
  if (defaults.length === 0) return;
  await prisma.taskResponseTag.createMany({
    data: defaults.map((d) => ({ taskResponseId, tagValueId: d.tagValueId })),
    skipDuplicates: true,
  });
}

/**
 * A photo taken for an answer starts with its task response's tags, so a
 * survey's photos arrive in the gallery already filed. Tags the photo was
 * given some other way are kept; inherited ones only fill types it lacks.
 */
export async function inheritTaskResponseTags(evidenceId: string, answerId: string) {
  const answer = await prisma.assessmentAnswer.findUnique({
    where: { id: answerId },
    select: { taskResponse: { select: { tags: { include: { tagValue: { include: { tagType: true } } } } } } },
  });
  const inherited = answer?.taskResponse?.tags ?? [];
  if (inherited.length === 0) return;
  const own = await prisma.evidenceTag.findMany({ where: { evidenceId }, include: { tagValue: { select: { tagTypeId: true } } } });
  const typesTaken = new Set(own.map((t) => t.tagValue.tagTypeId));
  await prisma.evidenceTag.createMany({
    data: inherited
      .filter((t) => t.tagValue.tagType.allowMultiple || !typesTaken.has(t.tagValue.tagTypeId))
      .map((t) => ({ evidenceId, tagValueId: t.tagValueId })),
    skipDuplicates: true,
  });
}

// ---------------------------------------------------------------------------
// Flags and comments
// ---------------------------------------------------------------------------

export async function setEvidenceFlag(ctx: SessionContext, evidenceId: string, flagged: boolean) {
  if (!hasPermission(ctx.role, "canUploadEvidence")) throw new ApiError(403, "Missing permission: canUploadEvidence");
  const evidence = await loadVisibleEvidence(ctx, evidenceId);
  return prisma.evidence.update({
    where: { id: evidence.id },
    data: flagged ? { isFlagged: true, flaggedAt: new Date(), flaggedById: ctx.userId } : { isFlagged: false, flaggedAt: null, flaggedById: null },
    select: { id: true, isFlagged: true, flaggedAt: true },
  });
}

/**
 * Which way a 360 panorama faces: the compass direction of its centre, set by
 * a person looking at it. Kept in the panorama's metadata next to whatever
 * the camera recorded, and marked as set by hand.
 */
export async function setPanoramaHeading(ctx: SessionContext, evidenceId: string, heading: number) {
  if (!hasPermission(ctx.role, "canUploadEvidence")) throw new ApiError(403, "Missing permission: canUploadEvidence");
  if (!Number.isFinite(heading)) throw new ApiError(400, "Heading must be a number of degrees");
  const evidence = await loadVisibleEvidence(ctx, evidenceId);
  const row = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id }, select: { type: true, metadata: true } });
  if (row.type !== "IMAGE_360") throw new ApiError(400, "Only a 360 panorama has a heading");
  const metadata = (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {}) as Record<string, unknown>;
  const normalised = ((heading % 360) + 360) % 360;
  await prisma.evidence.update({
    where: { id: evidence.id },
    data: { metadata: { ...metadata, heading: normalised, headingSource: "manual" } },
  });
  return { id: evidence.id, heading: normalised };
}

/** Comments are open to anyone who can see the photo, read-only roles included: a note is not an edit. */
export async function addEvidenceComment(ctx: SessionContext, evidenceId: string, body: string) {
  const evidence = await loadVisibleEvidence(ctx, evidenceId);
  const text = body.trim();
  if (!text) throw new ApiError(400, "A comment needs some text");
  if (text.length > 4000) throw new ApiError(400, "A comment is at most 4,000 characters");
  return prisma.evidenceComment.create({
    data: { evidenceId: evidence.id, authorId: ctx.userId, body: text },
    include: { author: { select: { id: true, name: true } } },
  });
}

export async function listEvidenceComments(ctx: SessionContext, evidenceId: string) {
  const evidence = await loadVisibleEvidence(ctx, evidenceId);
  return prisma.evidenceComment.findMany({
    where: { evidenceId: evidence.id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true } } },
  });
}

/** A comment is removed by its author, or by a property manager tidying up. */
export async function deleteEvidenceComment(ctx: SessionContext, commentId: string) {
  const comment = await prisma.evidenceComment.findFirst({ where: { id: commentId, evidence: { organizationId: ctx.organizationId } } });
  if (!comment) throw new ApiError(404, "Comment not found");
  await loadVisibleEvidence(ctx, comment.evidenceId);
  if (comment.authorId !== ctx.userId && !hasPermission(ctx.role, "canManageProperties")) {
    throw new ApiError(403, "Only the person who wrote this comment can remove it");
  }
  await prisma.evidenceComment.delete({ where: { id: comment.id } });
}
