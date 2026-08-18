import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { reindexDocument } from "@/lib/admin-service";

type RouteParams = { params: Promise<{ id: string }> };

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const document = await reindexDocument(ctx, id);
  return NextResponse.json(document);
});
