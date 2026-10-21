import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { deleteTagType } from "@/lib/tag-service";

type RouteParams = { params: Promise<{ id: string }> };

// DELETE — removes the type, its values, and those tags from every photo and response.
export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  return NextResponse.json({ removedFrom: await deleteTagType(ctx, id) });
});
