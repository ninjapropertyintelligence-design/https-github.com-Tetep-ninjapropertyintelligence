import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { deleteEmbed } from "@/lib/embed-service";

type RouteParams = { params: Promise<{ id: string }> };

export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  await deleteEmbed(ctx, id);
  return NextResponse.json({ deleted: true });
});
