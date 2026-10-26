import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { setPanoramaHeading } from "@/lib/tag-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({ heading: z.number().min(-360).max(720) });

export const PUT = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await setPanoramaHeading(ctx, id, schema.parse(await req.json()).heading));
});
