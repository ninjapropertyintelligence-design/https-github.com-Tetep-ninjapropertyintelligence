import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { markCaptureFailed } from "@/lib/drone-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };
const schema = z.object({ errorMessage: z.string().min(1).max(1000) });

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canPerformCapture");
  const { id } = await params;
  const input = schema.parse(await req.json());
  const capture = await markCaptureFailed(ctx, id, input.errorMessage);
  return NextResponse.json(capture);
});
