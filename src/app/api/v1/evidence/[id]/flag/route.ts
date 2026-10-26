import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { setEvidenceFlag } from "@/lib/tag-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({ flagged: z.boolean() });

export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await setEvidenceFlag(ctx, id, schema.parse(await req.json()).flagged));
});
