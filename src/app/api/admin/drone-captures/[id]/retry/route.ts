import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { retryDroneCapture } from "@/lib/admin-service";

type RouteParams = { params: Promise<{ id: string }> };

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const capture = await retryDroneCapture(ctx, id);
  return NextResponse.json(capture);
});
