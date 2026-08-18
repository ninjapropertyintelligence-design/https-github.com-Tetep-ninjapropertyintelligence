import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { registerDroneOutput } from "@/lib/drone-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };
const schema = z.object({
  outputType: z.enum(["PHOTO_SET", "ORTHOMOSAIC", "POINT_CLOUD", "MESH_3D", "DSM", "DTM"]),
  storageKey: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  checksum: z.string().length(64).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canPerformCapture");
  const { id } = await params;
  const input = schema.parse(await req.json());
  const output = await registerDroneOutput(ctx, id, input);
  return NextResponse.json(output, { status: 201 });
});
