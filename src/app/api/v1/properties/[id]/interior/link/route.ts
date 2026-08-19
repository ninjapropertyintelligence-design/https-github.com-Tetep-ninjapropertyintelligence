import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { linkSpaceToProperty } from "@/lib/matterport-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };
const schema = z.object({ externalSpaceId: z.string().min(1) });

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canPerformCapture");
  const { id } = await params;
  const input = schema.parse(await req.json());
  const link = await linkSpaceToProperty(ctx, id, input.externalSpaceId);
  return NextResponse.json(link, { status: 201 });
});
