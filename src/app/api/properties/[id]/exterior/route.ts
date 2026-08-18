import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { getPropertyExteriorData } from "@/lib/drone-service";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const data = await getPropertyExteriorData(ctx, id);
  return NextResponse.json(data);
});
