import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { setProjectMemberActive } from "@/lib/project-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string; memberId: string }> };

const schema = z.object({ isActive: z.boolean() });

export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id, memberId } = await params;
  const input = schema.parse(await req.json());
  return NextResponse.json(await setProjectMemberActive(ctx, id, memberId, input.isActive));
});
