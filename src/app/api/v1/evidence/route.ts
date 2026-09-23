import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api-utils";
import { createEvidence } from "@/lib/evidence-service";
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

// GET /api/v1/evidence?propertyId=&assetId=&issueId=
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

// POST /api/v1/evidence — register metadata after the client has PUT the bytes
// to the signed URL from /api/v1/evidence/upload-url.
//
// The route parses; `createEvidence` decides. Scoping, the 360 entitlement
// and the usage meter live there so they also hold for any non-HTTP caller.
export const POST = withApiHandler(async (ctx, req) => {
  const input = createEvidenceSchema.parse(await req.json());
  const evidence = await createEvidence(ctx, {
    ...input,
    metadata: input.metadata as Record<string, unknown>,
  });
  return NextResponse.json(evidence, { status: 201 });
});
