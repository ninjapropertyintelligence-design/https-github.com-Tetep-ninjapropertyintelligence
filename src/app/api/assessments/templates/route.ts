import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { z } from "zod";

export const GET = withApiHandler(async (ctx) => {
  const templates = await prisma.assessmentTemplate.findMany({
    where: { organizationId: ctx.organizationId, isActive: true },
    include: { sections: { include: { questions: true }, orderBy: { position: "asc" } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ items: templates });
});

const questionSchema = z.object({
  prompt: z.string().min(1),
  type: z.enum([
    "YES_NO",
    "TEXT",
    "NUMBER",
    "SELECT",
    "MULTI_SELECT",
    "CONDITION",
    "PHOTO",
    "VIDEO",
    "MEASUREMENT",
    "ASSET",
    "SIGNATURE",
  ]),
  isRequired: z.boolean().default(false),
  options: z.array(z.string()).default([]),
  category: z.string().nullish(),
});

const sectionSchema = z.object({
  name: z.string().min(1),
  questions: z.array(questionSchema).default([]),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  sections: z.array(sectionSchema).min(1),
});

export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canManageAssessmentTemplates");
  const body = await req.json();
  const input = createTemplateSchema.parse(body);

  const template = await prisma.assessmentTemplate.create({
    data: {
      organizationId: ctx.organizationId,
      name: input.name,
      description: input.description ?? null,
      sections: {
        create: input.sections.map((section, sIdx) => ({
          name: section.name,
          position: sIdx,
          questions: {
            create: section.questions.map((q, qIdx) => ({
              prompt: q.prompt,
              type: q.type,
              isRequired: q.isRequired,
              options: q.options,
              category: q.category ?? null,
              position: qIdx,
            })),
          },
        })),
      },
    },
    include: { sections: { include: { questions: true } } },
  });

  return NextResponse.json(template, { status: 201 });
});
