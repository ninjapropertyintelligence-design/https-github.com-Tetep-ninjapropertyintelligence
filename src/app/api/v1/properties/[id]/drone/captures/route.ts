import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { createDroneCapture } from "@/lib/drone-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };
const schema = z.object({
  capturedAt: z.coerce.date().optional(),
  droneModel: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canPerformCapture");
  const { id } = await params;
  const input = schema.parse(await req.json());
  const capture = await createDroneCapture(ctx, id, input);
  return NextResponse.json(capture, { status: 201 });
});
