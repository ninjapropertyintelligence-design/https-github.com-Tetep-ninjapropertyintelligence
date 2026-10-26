import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { deleteTagValue } from "@/lib/tag-service";

type RouteParams = { params: Promise<{ id: string }> };

// DELETE — removes the value and that tag from every photo and response.
export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  return NextResponse.json({ removedFrom: await deleteTagValue(ctx, id) });
});
