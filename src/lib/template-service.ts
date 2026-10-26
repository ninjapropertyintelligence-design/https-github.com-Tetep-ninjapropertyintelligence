import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import type { SessionContext } from "@/lib/tenant-scope";
import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { resolveTagValues } from "@/lib/tag-service";

/**
 * Assessment templates: sections of tasks of questions, as the builder edits
 * them.
 *
 * A template no assessment has used can be changed freely. Once one has been
 * run, its questions are what recorded answers point at, so changing them in
 * place would rewrite what past inspectors were asked. Instead a change is
 * saved as a new version and the old one is retired: it stops being offered
 * for new assessments and keeps answering for the old ones.
 */

export const QUESTION_TYPES = [
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
] as const;

const questionSchema = z
  .object({
    prompt: z.string().trim().min(1, "Every question needs a prompt").max(500),
    type: z.enum(QUESTION_TYPES),
    isRequired: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    category: z.string().trim().max(100).nullish(),
  })
  .refine((q) => !(q.type === "SELECT" || q.type === "MULTI_SELECT") || q.options.length >= 2, {
    message: "A choice question needs at least two options",
  });

const taskSchema = z.object({
  name: z.string().trim().min(1, "Every task needs a name").max(200),
  description: z.string().trim().max(2000).nullish(),
  isRequired: z.boolean().default(true),
  isRepeatable: z.boolean().default(false),
  isCompletable: z.boolean().default(true),
  /** Organization-wide tag values every new response of this task starts with. */
  defaultTagValueIds: z.array(z.string().min(1)).max(20).default([]),
  questions: z.array(questionSchema).min(1, "Every task needs at least one question").max(100),
});

const sectionSchema = z.object({
  name: z.string().trim().min(1, "Every section needs a name").max(200),
  /** Asked once per assessment, directly in the section. */
  questions: z.array(questionSchema).max(200).default([]),
  tasks: z.array(taskSchema).max(100).default([]),
});

export const templateDefinitionSchema = z
  .object({
    name: z.string().trim().min(1, "The template needs a name").max(200),
    description: z.string().trim().max(2000).nullish(),
    sections: z.array(sectionSchema).min(1, "Add at least one section").max(50),
  })
  .refine((t) => t.sections.every((s) => s.questions.length + s.tasks.length > 0), {
    message: "Every section needs a question or a task",
  });

export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;
type QuestionInput = z.infer<typeof questionSchema>;

function requireTemplateManager(ctx: SessionContext) {
  if (!hasPermission(ctx.role, "canManageAssessmentTemplates")) {
    throw new ApiError(403, "Missing permission: canManageAssessmentTemplates");
  }
}

async function loadTemplate(ctx: SessionContext, templateId: string) {
  const template = await prisma.assessmentTemplate.findFirst({ where: { id: templateId, organizationId: ctx.organizationId } });
  if (!template) throw new ApiError(404, "Template not found");
  return template;
}

function questionRow(q: QuestionInput, position: number) {
  return {
    prompt: q.prompt,
    type: q.type,
    isRequired: q.isRequired,
    options: q.options,
    category: q.category || null,
    position,
  };
}

/** Writes a definition's sections, tasks and questions under a template that has none. */
async function writeStructure(tx: Prisma.TransactionClient, templateId: string, def: TemplateDefinition) {
  // Sections and tasks first, questions after: a task's question carries both
  // ids, and the section id must be the task's own, which a nested create
  // that can set only one parent cannot guarantee.
  for (const [sIdx, section] of def.sections.entries()) {
    const sectionRow = await tx.assessmentSection.create({
      data: {
        templateId,
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
          description: task.description || null,
          position: tIdx,
          isRequired: task.isRequired,
          isRepeatable: task.isRepeatable,
          isCompletable: task.isCompletable,
        },
      });
      await tx.assessmentQuestion.createMany({
        data: task.questions.map((q, qIdx) => ({ ...questionRow(q, qIdx), sectionId: sectionRow.id, taskId: taskRow.id })),
      });
      if (task.defaultTagValueIds.length > 0) {
        await tx.assessmentTaskDefaultTag.createMany({
          data: [...new Set(task.defaultTagValueIds)].map((tagValueId) => ({ taskId: taskRow.id, tagValueId })),
        });
      }
    }
  }
}

/**
 * A template is used at every property, so its default tags must be
 * organization-wide values — a property's own "Mezzanine" cannot be a
 * default for a survey run everywhere.
 */
async function checkDefaultTags(ctx: SessionContext, def: TemplateDefinition) {
  for (const task of def.sections.flatMap((s) => s.tasks)) {
    try {
      await resolveTagValues(ctx.organizationId, null, task.defaultTagValueIds);
    } catch (err) {
      if (err instanceof ApiError) throw new ApiError(400, `Task "${task.name}": ${err.message}`);
      throw err;
    }
  }
}

export async function createTemplate(ctx: SessionContext, input: unknown) {
  requireTemplateManager(ctx);
  const def = templateDefinitionSchema.parse(input);
  await checkDefaultTags(ctx, def);
  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.assessmentTemplate.create({
      data: { organizationId: ctx.organizationId, name: def.name, description: def.description || null },
    });
    await writeStructure(tx, created.id, def);
    return created;
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "assessment_template.created",
    entityType: "AssessmentTemplate",
    entityId: template.id,
  });
  return template;
}

/** Replaces a template's contents. Only while no assessment has used it. */
export async function replaceTemplate(ctx: SessionContext, templateId: string, input: unknown) {
  requireTemplateManager(ctx);
  const template = await loadTemplate(ctx, templateId);
  const def = templateDefinitionSchema.parse(input);
  await checkDefaultTags(ctx, def);
  const used = await prisma.assessment.count({ where: { templateId: template.id } });
  if (used > 0) {
    throw new ApiError(409, `This template has been used by ${used} assessment${used === 1 ? "" : "s"}; save your changes as a new version`);
  }
  await prisma.$transaction(async (tx) => {
    // Deleting the sections cascades to their tasks and questions. Nothing
    // else points at them: no assessment uses this template.
    await tx.assessmentSection.deleteMany({ where: { templateId: template.id } });
    await tx.assessmentTemplate.update({
      where: { id: template.id },
      data: { name: def.name, description: def.description || null },
    });
    await writeStructure(tx, template.id, def);
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "assessment_template.updated",
    entityType: "AssessmentTemplate",
    entityId: template.id,
  });
  return prisma.assessmentTemplate.findUniqueOrThrow({ where: { id: template.id } });
}

/** Saves a changed definition as a new template and retires the one it came from. */
export async function saveAsNewVersion(ctx: SessionContext, templateId: string, input: unknown) {
  requireTemplateManager(ctx);
  const previous = await loadTemplate(ctx, templateId);
  const created = await createTemplate(ctx, input);
  await prisma.assessmentTemplate.update({ where: { id: previous.id }, data: { isActive: false } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "assessment_template.superseded",
    entityType: "AssessmentTemplate",
    entityId: previous.id,
    metadata: { replacedBy: created.id },
  });
  return created;
}

/** Retires a template from new assessments, or brings it back. */
export async function setTemplateActive(ctx: SessionContext, templateId: string, isActive: boolean) {
  requireTemplateManager(ctx);
  const template = await loadTemplate(ctx, templateId);
  return prisma.assessmentTemplate.update({ where: { id: template.id }, data: { isActive } });
}

/** A template as the builder edits it, plus whether it can still be changed in place. */
export async function getTemplateDefinition(ctx: SessionContext, templateId: string) {
  const template = await prisma.assessmentTemplate.findFirst({
    where: { id: templateId, organizationId: ctx.organizationId },
    include: {
      _count: { select: { assessments: true } },
      sections: {
        orderBy: { position: "asc" },
        include: {
          questions: { where: { taskId: null }, orderBy: { position: "asc" } },
          tasks: {
            orderBy: { position: "asc" },
            include: { questions: { orderBy: { position: "asc" } }, defaultTags: { select: { tagValueId: true } } },
          },
        },
      },
    },
  });
  if (!template) throw new ApiError(404, "Template not found");
  const toQuestion = (q: (typeof template.sections)[number]["questions"][number]): QuestionInput => ({
    prompt: q.prompt,
    type: q.type,
    isRequired: q.isRequired,
    options: Array.isArray(q.options) ? (q.options as string[]) : [],
    category: q.category,
  });
  const definition: TemplateDefinition = {
    name: template.name,
    description: template.description,
    sections: template.sections.map((s) => ({
      name: s.name,
      questions: s.questions.map(toQuestion),
      tasks: s.tasks.map((t) => ({
        name: t.name,
        description: t.description,
        isRequired: t.isRequired,
        isRepeatable: t.isRepeatable,
        isCompletable: t.isCompletable,
        defaultTagValueIds: t.defaultTags.map((d) => d.tagValueId),
        questions: t.questions.map(toQuestion),
      })),
    })),
  };
  return { id: template.id, isActive: template.isActive, usedBy: template._count.assessments, definition };
}

export async function listTemplatesForManagers(ctx: SessionContext) {
  const templates = await prisma.assessmentTemplate.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      _count: { select: { assessments: true, sections: true } },
      sections: { select: { _count: { select: { tasks: true, questions: true } } } },
    },
  });
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    isActive: t.isActive,
    updatedAt: t.updatedAt,
    usedBy: t._count.assessments,
    sections: t._count.sections,
    tasks: t.sections.reduce((n, s) => n + s._count.tasks, 0),
    questions: t.sections.reduce((n, s) => n + s._count.questions, 0),
  }));
}
