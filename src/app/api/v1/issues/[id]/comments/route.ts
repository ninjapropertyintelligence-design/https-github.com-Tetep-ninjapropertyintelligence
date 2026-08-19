import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { issueScopeWhere } from "@/lib/session-context";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({ body: z.string().min(1).max(4000) });

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const issue = await prisma.issue.findFirst({ where: { AND: [{ id }, issueScopeWhere(ctx)] } });
  if (!issue) throw new ApiError(404, "Issue not found");

  const input = schema.parse(await req.json());
  const comment = await prisma.issueComment.create({
    data: { issueId: issue.id, authorId: ctx.userId, body: input.body },
  });
  return NextResponse.json(comment, { status: 201 });
});
