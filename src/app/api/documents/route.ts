import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { writeAuditLog } from "@/lib/audit";
import { extractAndIndexDocument } from "@/lib/document-extraction";
import { z } from "zod";

const DOCUMENT_TYPES = [
  "PDF",
  "CAD_REFERENCE",
  "BIM_REFERENCE",
  "WARRANTY",
  "INSPECTION_REPORT",
  "MANUAL",
  "PERMIT",
  "CONTRACT",
  "ROOF_REPORT",
  "FLOOR_PLAN",
  "OTHER",
] as const;

// GET /api/documents?propertyId=&assetId=&issueId=&type=
export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const propertyId = url.searchParams.get("propertyId");
  const assetId = url.searchParams.get("assetId");
  const issueId = url.searchParams.get("issueId");
  const documentType = url.searchParams.get("type");

  const items = await prisma.document.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(propertyId ? { propertyId } : {}),
      ...(assetId ? { assetId } : {}),
      ...(issueId ? { issueId } : {}),
      ...(documentType ? { documentType: documentType as never } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  return NextResponse.json({ items });
});

const createDocumentSchema = z.object({
  title: z.string().min(1).max(300),
  documentType: z.enum(DOCUMENT_TYPES).default("OTHER"),
  tags: z.array(z.string()).default([]),
  propertyId: z.string().nullish(),
  assetId: z.string().nullish(),
  issueId: z.string().nullish(),
  storageKey: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});

// POST /api/documents — registers metadata + version 1 after a signed upload.
export const POST = withApiHandler(async (ctx, req) => {
  const body = await req.json();
  const input = createDocumentSchema.parse(body);

  if (input.propertyId) {
    const property = await prisma.property.findFirst({
      where: { AND: [{ id: input.propertyId }, propertyScopeWhere(ctx)] },
    });
    if (!property) throw new ApiError(400, "Invalid propertyId, or you don't have access to it");
  }

  const document = await prisma.document.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: input.propertyId ?? null,
      assetId: input.assetId ?? null,
      issueId: input.issueId ?? null,
      title: input.title,
      documentType: input.documentType,
      tags: input.tags,
      versions: {
        create: {
          versionNumber: 1,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          storageKey: input.storageKey,
          uploadedById: ctx.userId,
        },
      },
    },
    include: { versions: true },
  });

  if (input.propertyId) {
    await emitEvent({
      organizationId: ctx.organizationId,
      propertyId: input.propertyId,
      type: EVENT_TYPES.DOCUMENT_UPLOADED,
      actorUserId: ctx.userId,
      payload: { documentId: document.id, title: document.title },
    });
  }
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "document.uploaded",
    entityType: "Document",
    entityId: document.id,
  });

  // Extraction is small (PDF text only) so it runs inline rather than via a
  // background job queue — a real job runner is the natural next step if
  // large documents make this request latency noticeable.
  await extractAndIndexDocument(document.id);

  return NextResponse.json(document, { status: 201 });
});
