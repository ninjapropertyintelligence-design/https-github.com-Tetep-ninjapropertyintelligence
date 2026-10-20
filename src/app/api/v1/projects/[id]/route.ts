import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { getProject, updateProject } from "@/lib/project-service";
import { ProjectStatus } from "@/generated/prisma/enums";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const project = await getProject(ctx, id);
  if (!project) throw new ApiError(404, "Project not found");
  return NextResponse.json(project);
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  programId: z.string().nullish(),
  projectType: z.string().max(100).nullish(),
  description: z.string().max(4000).nullish(),
  status: z.enum(ProjectStatus).optional(),
  startDate: z.coerce.date().nullish(),
  endDate: z.coerce.date().nullish(),
});

export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const input = patchSchema.parse(await req.json());
  return NextResponse.json(await updateProject(ctx, id, input));
});
