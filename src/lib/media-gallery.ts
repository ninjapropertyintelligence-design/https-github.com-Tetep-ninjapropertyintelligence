import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { evidenceScopeWhere, propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import type { EvidenceType } from "@/generated/prisma/client";

/**
 * Everything a property's media gallery shows, in one read.
 *
 * Filtering and sorting happen in the browser over this list, so changing a
 * filter is instant and costs no request. That holds up to a few thousand
 * items; past the cap the newest are returned and `truncated` says so,
 * rather than a gallery that quietly stops at an arbitrary number.
 */

export const GALLERY_TYPES: EvidenceType[] = ["PHOTO", "IMAGE_360", "DRONE_IMAGE", "VIDEO"];
export const MAX_GALLERY_ITEMS = 3000;

export interface GalleryItem {
  id: string;
  type: EvidenceType;
  /** When it was taken if known, otherwise when it was uploaded. ISO. */
  takenAt: string;
  capturedKnown: boolean;
  uploadedBy: string;
  isFlagged: boolean;
  tagValueIds: string[];
  comments: number;
  /** What it was taken for, when it was taken for something. */
  context: { kind: "assessment" | "issue" | "asset"; id: string; label: string } | null;
}

export async function getPropertyMedia(ctx: SessionContext, propertyId: string): Promise<{ items: GalleryItem[]; truncated: boolean }> {
  const property = await prisma.property.findFirst({ where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] }, select: { id: true } });
  if (!property) throw new ApiError(404, "Property not found");

  const rows = await prisma.evidence.findMany({
    // Scoped as evidence, not only by property: vendor work still under
    // review stays out of the gallery as it does everywhere else.
    where: { AND: [evidenceScopeWhere(ctx), { propertyId: property.id }, { type: { in: GALLERY_TYPES } }] },
    orderBy: [{ captureDate: "desc" }, { createdAt: "desc" }],
    take: MAX_GALLERY_ITEMS + 1,
    select: {
      id: true,
      type: true,
      captureDate: true,
      createdAt: true,
      isFlagged: true,
      uploadedBy: { select: { name: true } },
      tags: { select: { tagValueId: true } },
      _count: { select: { comments: true } },
      assessment: { select: { id: true, template: { select: { name: true } } } },
      issue: { select: { id: true, title: true } },
      asset: { select: { id: true, name: true } },
    },
  });

  const items = rows.slice(0, MAX_GALLERY_ITEMS).map((r) => ({
    id: r.id,
    type: r.type,
    takenAt: (r.captureDate ?? r.createdAt).toISOString(),
    capturedKnown: r.captureDate !== null,
    uploadedBy: r.uploadedBy.name,
    isFlagged: r.isFlagged,
    tagValueIds: r.tags.map((t) => t.tagValueId),
    comments: r._count.comments,
    context: r.assessment
      ? { kind: "assessment" as const, id: r.assessment.id, label: r.assessment.template.name }
      : r.issue
        ? { kind: "issue" as const, id: r.issue.id, label: r.issue.title }
        : r.asset
          ? { kind: "asset" as const, id: r.asset.id, label: r.asset.name }
          : null,
  }));
  return { items, truncated: rows.length > MAX_GALLERY_ITEMS };
}
