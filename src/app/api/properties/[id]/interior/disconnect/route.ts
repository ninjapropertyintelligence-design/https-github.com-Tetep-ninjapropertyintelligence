import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { disconnectPropertyInterior } from "@/lib/matterport-service";

type RouteParams = { params: Promise<{ id: string }> };

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  requirePermission(ctx, "canPerformCapture");
  const { id } = await params;
  await disconnectPropertyInterior(ctx, id);
  return NextResponse.json({ ok: true });
});
