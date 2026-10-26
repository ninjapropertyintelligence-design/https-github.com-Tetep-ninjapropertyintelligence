import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { addEvidenceComment, listEvidenceComments } from "@/lib/tag-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  return NextResponse.json({ items: await listEvidenceComments(ctx, id) });
});

const schema = z.object({ body: z.string().min(1).max(4000) });

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await addEvidenceComment(ctx, id, schema.parse(await req.json()).body), { status: 201 });
});
