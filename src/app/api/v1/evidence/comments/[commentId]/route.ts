import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { deleteEvidenceComment } from "@/lib/tag-service";

type RouteParams = { params: Promise<{ commentId: string }> };

export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { commentId } = await params;
  await deleteEvidenceComment(ctx, commentId);
  return NextResponse.json({ deleted: true });
});
