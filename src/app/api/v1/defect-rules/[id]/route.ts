import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { deleteDefectRule } from "@/lib/ai-finding-service";

type RouteParams = { params: Promise<{ id: string }> };

export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  await deleteDefectRule(ctx, id);
  return NextResponse.json({ ok: true });
});
