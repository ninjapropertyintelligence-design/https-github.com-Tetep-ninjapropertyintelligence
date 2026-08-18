import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { getPropertyInteriorStatus } from "@/lib/matterport-service";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const status = await getPropertyInteriorStatus(ctx, id);
  return NextResponse.json(status);
});
