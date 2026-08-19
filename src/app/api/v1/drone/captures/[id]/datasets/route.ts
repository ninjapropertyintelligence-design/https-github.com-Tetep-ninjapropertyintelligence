import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { createDroneDataset } from "@/lib/drone-service";

type RouteParams = { params: Promise<{ id: string }> };

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  requirePermission(ctx, "canPerformCapture");
  const { id } = await params;
  const dataset = await createDroneDataset(ctx, id);
  return NextResponse.json(dataset, { status: 201 });
});
