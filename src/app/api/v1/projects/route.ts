import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createProject, listProjects } from "@/lib/project-service";
import { ProjectStatus } from "@/generated/prisma/enums";
import { z } from "zod";

const statusSchema = z.enum(ProjectStatus);

// GET /api/v1/projects?status=&programId=&propertyId=&q=
export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  return NextResponse.json(
    await listProjects(ctx, {
      status: status ? statusSchema.parse(status) : null,
      programId: url.searchParams.get("programId"),
      propertyId: url.searchParams.get("propertyId"),
      q: url.searchParams.get("q"),
      archived: url.searchParams.get("archived") === "true",
    }),
  );
});

const projectBodySchema = z.object({
  name: z.string().min(1).max(200),
  programId: z.string().nullish(),
  projectType: z.string().max(100).nullish(),
  description: z.string().max(4000).nullish(),
  status: statusSchema.optional(),
  startDate: z.coerce.date().nullish(),
  endDate: z.coerce.date().nullish(),
});

const createSchema = projectBodySchema.extend({ propertyId: z.string().min(1) });

export const POST = withApiHandler(async (ctx, req) => {
  const input = createSchema.parse(await req.json());
  return NextResponse.json(await createProject(ctx, input), { status: 201 });
});
