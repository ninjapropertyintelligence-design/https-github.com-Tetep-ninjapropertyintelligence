import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createEvidenceBatch } from "@/lib/evidence-service";
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

const schema = z.object({
  items: z
    .array(
      z.object({
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
        captureShotId: z.string().nullish(),
        latitude: z.number().nullish(),
        longitude: z.number().nullish(),
        metadata: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1),
});

// Bulk step 2: register a whole upload in one call.
export const POST = withApiHandler(async (ctx, req) => {
  const { items } = schema.parse(await req.json());
  const result = await createEvidenceBatch(
    ctx,
    items.map((i) => ({ ...i, metadata: i.metadata as Record<string, unknown> })),
  );
  return NextResponse.json(result, { status: 201 });
});
