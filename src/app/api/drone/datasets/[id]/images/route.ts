import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { registerDroneImage } from "@/lib/drone-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };
const schema = z.object({
  storageKey: z.string().min(1),
  thumbnailKey: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  checksum: z.string().length(64).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  altitude: z.number().optional(),
  capturedAt: z.coerce.date().optional(),
});

// POST /api/drone/datasets/[id]/images — registers metadata after the
// client has PUT bytes to the signed URL from /api/drone/upload-url.
// Verifies size/checksum against what's actually in storage (spec §5/6).
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canPerformCapture");
  const { id } = await params;
  const input = schema.parse(await req.json());
  const image = await registerDroneImage(ctx, id, input);
  return NextResponse.json(image, { status: 201 });
});
