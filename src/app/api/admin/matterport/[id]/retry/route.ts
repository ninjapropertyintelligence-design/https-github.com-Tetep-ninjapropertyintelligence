import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { retryMatterportConnection } from "@/lib/admin-service";

type RouteParams = { params: Promise<{ id: string }> };

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const connection = await retryMatterportConnection(ctx, id);
  return NextResponse.json(connection);
});
