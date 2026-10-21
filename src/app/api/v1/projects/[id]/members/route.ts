import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { addProjectMember, listProjectMembers } from "@/lib/project-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

// GET ?status=active|inactive&q=
export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const items = await listProjectMembers(ctx, id, {
    active: status === "active" ? true : status === "inactive" ? false : null,
    q: url.searchParams.get("q"),
  });
  return NextResponse.json({ items });
});

const schema = z.object({ userId: z.string().min(1) });

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const input = schema.parse(await req.json());
  return NextResponse.json(await addProjectMember(ctx, id, input.userId), { status: 201 });
});
