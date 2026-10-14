import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { registerDroneImagesBatch } from "@/lib/drone-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({
  images: z
    .array(
      z.object({
        storageKey: z.string().min(1),
        thumbnailKey: z.string().optional(),
        mimeType: z.string().optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
        checksum: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        altitude: z.number().optional(),
        capturedAt: z.coerce.date().optional(),
      }),
    )
    .min(1),
});

// Registers a whole flight against one dataset. The single-image endpoint
// beside this one is fine for a correction; a real flight is several hundred
// files and arrives here instead.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canPerformCapture");
  const { id } = await params;
  const { images } = schema.parse(await req.json());
  return NextResponse.json(await registerDroneImagesBatch(ctx, id, images), { status: 201 });
});
