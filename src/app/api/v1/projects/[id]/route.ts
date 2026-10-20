import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { deleteProject, getProject, setProjectArchived, updateProject } from "@/lib/project-service";
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
  archived: z.boolean().optional(),
});

export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const { archived, ...input } = patchSchema.parse(await req.json());
  if (archived !== undefined) await setProjectArchived(ctx, id, archived);
  return NextResponse.json(Object.keys(input).length > 0 ? await updateProject(ctx, id, input) : await getProject(ctx, id));
});

// DELETE — remove the project; its assessments and documents are kept and unlinked.
export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await deleteProject(ctx, id));
});
