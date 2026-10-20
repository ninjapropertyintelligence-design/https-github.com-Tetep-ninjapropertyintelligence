import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { z } from "zod";

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

const taskSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  isRequired: z.boolean().default(true),
  isRepeatable: z.boolean().default(false),
  isCompletable: z.boolean().default(true),
  questions: z.array(questionSchema).min(1),
});

const sectionSchema = z.object({
  name: z.string().min(1),
  /** Asked once per assessment, directly in the section. */
  questions: z.array(questionSchema).default([]),
  tasks: z.array(taskSchema).default([]),
});

type QuestionInput = z.infer<typeof questionSchema>;

function questionRow(q: QuestionInput, position: number) {
  return {
    prompt: q.prompt,
    type: q.type,
    isRequired: q.isRequired,
    options: q.options,
    category: q.category ?? null,
    position,
  };
}

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  sections: z.array(sectionSchema).min(1),
});

export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canManageAssessmentTemplates");
  const body = await req.json();
  const input = createTemplateSchema.parse(body);

  // A task's questions carry both ids, and the section id must be the task's
  // own — so the sections and tasks are created first and the questions
  // after, rather than through a nested create that can only set one parent.
  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.assessmentTemplate.create({
      data: { organizationId: ctx.organizationId, name: input.name, description: input.description ?? null },
    });
    for (const [sIdx, section] of input.sections.entries()) {
      const sectionRow = await tx.assessmentSection.create({
        data: {
          templateId: created.id,
          name: section.name,
          position: sIdx,
          questions: { create: section.questions.map((q, qIdx) => questionRow(q, qIdx)) },
        },
      });
      for (const [tIdx, task] of section.tasks.entries()) {
        const taskRow = await tx.assessmentTask.create({
          data: {
            sectionId: sectionRow.id,
            name: task.name,
            description: task.description ?? null,
            position: tIdx,
            isRequired: task.isRequired,
            isRepeatable: task.isRepeatable,
            isCompletable: task.isCompletable,
          },
        });
        await tx.assessmentQuestion.createMany({
          data: task.questions.map((q, qIdx) => ({ ...questionRow(q, qIdx), sectionId: sectionRow.id, taskId: taskRow.id })),
        });
      }
    }
    return tx.assessmentTemplate.findUniqueOrThrow({
      where: { id: created.id },
      include: { sections: { orderBy: { position: "asc" }, include: { questions: true, tasks: { include: { questions: true } } } } },
    });
  });

  return NextResponse.json(template, { status: 201 });
});
