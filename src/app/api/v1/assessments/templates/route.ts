import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api-utils";
import { createTemplate } from "@/lib/template-service";

// GET — active templates, with their sections, tasks and questions, for scheduling and running assessments.
export const GET = withApiHandler(async (ctx) => {
  const templates = await prisma.assessmentTemplate.findMany({
    where: { organizationId: ctx.organizationId, isActive: true },
    include: {
      sections: {
        orderBy: { position: "asc" },
        include: {
          questions: { where: { taskId: null }, orderBy: { position: "asc" } },
          tasks: { orderBy: { position: "asc" }, include: { questions: { orderBy: { position: "asc" } } } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ items: templates });
});

// POST — create a template from a builder definition. The shape and rules are `templateDefinitionSchema`.
export const POST = withApiHandler(async (ctx, req) => {
  return NextResponse.json(await createTemplate(ctx, await req.json()), { status: 201 });
});
