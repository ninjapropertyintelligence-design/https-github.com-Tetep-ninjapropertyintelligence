import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { z } from "zod";

const EVIDENCE_TYPES = [
  "PHOTO",
  "VIDEO",
  "DOCUMENT",
  "DRONE_IMAGE",
  "MATTERPORT_REFERENCE",
  "IMAGE_360",
  "MAP_REFERENCE",
  "POINT_CLOUD_REFERENCE",
] as const;

const createEvidenceSchema = z.object({
  type: z.enum(EVIDENCE_TYPES),
  storageKey: z.string().min(1),
  thumbnailKey: z.string().nullish(),
  mimeType: z.string().nullish(),
  sizeBytes: z.number().int().nonnegative().nullish(),
  propertyId: z.string().nullish(),
  assetId: z.string().nullish(),
  issueId: z.string().nullish(),
  assessmentId: z.string().nullish(),
  captureDate: z.coerce.date().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// GET /api/evidence?propertyId=&assetId=&issueId=
export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const propertyId = url.searchParams.get("propertyId");
  const assetId = url.searchParams.get("assetId");
  const issueId = url.searchParams.get("issueId");

  const items = await prisma.evidence.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(propertyId ? { propertyId } : {}),
      ...(assetId ? { assetId } : {}),
      ...(issueId ? { issueId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ items });
});

// POST /api/evidence — register metadata after the client has PUT the bytes
// to the signed URL from /api/evidence/upload-url.
export const POST = withApiHandler(async (ctx, req) => {
  const body = await req.json();
  const input = createEvidenceSchema.parse(body);

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
      metadata: input.metadata as unknown as Prisma.InputJsonValue,
      uploadedById: ctx.userId,
    },
  });

  if (input.propertyId) {
    await emitEvent({
      organizationId: ctx.organizationId,
      propertyId: input.propertyId,
      type: EVENT_TYPES.EVIDENCE_UPLOADED,
      actorUserId: ctx.userId,
      payload: { evidenceId: evidence.id, type: evidence.type },
    });
  }

  return NextResponse.json(evidence, { status: 201 });
});
