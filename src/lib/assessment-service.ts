import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { recordAssetConditionChange } from "@/lib/asset-condition";
import { recalculatePropertyHealth } from "@/lib/scoring";
import { hasPermission } from "@/lib/permissions";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import {
  computeAssessmentProgress,
  isAnswered,
  isAssessmentLocked,
  type AssessmentProgress,
} from "@/lib/assessment-progress";
import type { AssessmentStatus, Prisma } from "@/generated/prisma/client";

/**
 * Running an assessment: answering its questions, task by task, and moving it
 * through DRAFT -> IN_PROGRESS -> COMPLETED -> RELEASED.
 *
 * A template is sections of tasks of questions. A task is answered by one
 * *task response*; a repeatable task gets one response per thing found (three
 * roof drains, three responses), each numbered by `instance`. Questions asked
 * directly in a section, with no task, are answered once per assessment, as
 * before tasks existed.
 *
 * Who may write: someone who can perform assessments AND is either the
 * assigned inspector or a template manager. Tenant scope alone is not enough —
 * VIEWER passes scope for the whole organization. Once COMPLETED or RELEASED,
 * nothing changes until a template manager reopens it; RELEASED, the client
 * hand-off, is final.
 */

export const PHOTO_EVIDENCE_TYPES = ["PHOTO", "IMAGE_360"] as const;

async function loadAssessment(ctx: SessionContext, assessmentId: string) {
  const assessment = await prisma.assessment.findFirst({
    where: { AND: [{ id: assessmentId }, { organizationId: ctx.organizationId }, { property: propertyScopeWhere(ctx) }] },
    include: { template: { select: { name: true } } },
  });
  if (!assessment) throw new ApiError(404, "Assessment not found");
  return assessment;
}

/** Whether this caller may change the answers on this assessment, ignoring its status. */
export function mayWriteAssessment(ctx: SessionContext, assessment: { inspectorId: string }): boolean {
  if (!hasPermission(ctx.role, "canPerformAssessments")) return false;
  return assessment.inspectorId === ctx.userId || hasPermission(ctx.role, "canManageAssessmentTemplates");
}

function requireWritable(ctx: SessionContext, assessment: { inspectorId: string; status: AssessmentStatus }) {
  if (!mayWriteAssessment(ctx, assessment)) {
    throw new ApiError(403, "Only the assigned inspector or a template manager can change this assessment");
  }
  if (isAssessmentLocked(assessment.status)) {
    throw new ApiError(400, `Assessment is ${assessment.status.toLowerCase()} and its answers are locked`);
  }
}

async function markStarted(assessment: { id: string; status: AssessmentStatus; startedAt: Date | null }) {
  if (assessment.status !== "DRAFT") return;
  await prisma.assessment.update({
    where: { id: assessment.id },
    data: { status: "IN_PROGRESS", startedAt: assessment.startedAt ?? new Date() },
  });
}

// ---------------------------------------------------------------------------
// Task responses
// ---------------------------------------------------------------------------

async function loadTaskOnTemplate(taskId: string, templateId: string) {
  const task = await prisma.assessmentTask.findFirst({ where: { id: taskId, section: { templateId } } });
  if (!task) throw new ApiError(400, "Invalid taskId for this assessment's template");
  return task;
}

/** The first response to a task, created if the task has none yet. */
async function firstResponse(assessmentId: string, taskId: string) {
  const existing = await prisma.assessmentTaskResponse.findFirst({
    where: { assessmentId, taskId },
    orderBy: { instance: "asc" },
  });
  if (existing) return existing;
  return prisma.assessmentTaskResponse.upsert({
    where: { assessmentId_taskId_instance: { assessmentId, taskId, instance: 1 } },
    create: { assessmentId, taskId, instance: 1 },
    update: {},
  });
}

/** Adds another response to a repeatable task ("Add new response"). */
export async function addTaskResponse(
  ctx: SessionContext,
  assessmentId: string,
  input: { taskId: string; label?: string | null },
) {
  const assessment = await loadAssessment(ctx, assessmentId);
  requireWritable(ctx, assessment);
  const task = await loadTaskOnTemplate(input.taskId, assessment.templateId);

  const count = await prisma.assessmentTaskResponse.count({ where: { assessmentId, taskId: task.id } });
  if (count > 0 && !task.isRepeatable) {
    throw new ApiError(400, `"${task.name}" is not repeatable and already has a response`);
  }
  const last = await prisma.assessmentTaskResponse.findFirst({
    where: { assessmentId, taskId: task.id },
    orderBy: { instance: "desc" },
    select: { instance: true },
  });

  const response = await prisma.assessmentTaskResponse.create({
    data: { assessmentId, taskId: task.id, instance: (last?.instance ?? 0) + 1, label: input.label?.trim() || null },
  });
  await markStarted(assessment);
  return response;
}

async function loadResponse(ctx: SessionContext, assessmentId: string, responseId: string) {
  const assessment = await loadAssessment(ctx, assessmentId);
  const response = await prisma.assessmentTaskResponse.findFirst({
    where: { id: responseId, assessmentId: assessment.id },
    include: { task: { include: { questions: true } } },
  });
  if (!response) throw new ApiError(404, "Task response not found");
  return { assessment, response };
}

/** The required questions of a task that this response leaves unanswered. */
async function unansweredRequired(response: {
  id: string;
  task: { questions: Array<{ id: string; prompt: string; type: Parameters<typeof isAnswered>[0]; isRequired: boolean }> };
}) {
  const answers = await prisma.assessmentAnswer.findMany({
    where: { taskResponseId: response.id },
    include: { _count: { select: { evidence: true } } },
  });
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  return response.task.questions.filter((q) => {
    if (!q.isRequired) return false;
    const answer = byQuestion.get(q.id);
    return !isAnswered(q.type, answer, answer?._count.evidence ?? 0);
  });
}

/**
 * Re-derives a response's completion after its answers change.
 *
 * A task nobody marks complete is complete exactly when its required
 * questions are answered. A task somebody does mark complete stays as they
 * left it — unless a required answer is cleared, because "complete" with a
 * required answer missing is a claim the data no longer supports.
 */
async function refreshCompletion(responseId: string, actorUserId: string) {
  const response = await prisma.assessmentTaskResponse.findUniqueOrThrow({
    where: { id: responseId },
    include: { task: { include: { questions: true } } },
  });
  const satisfied = (await unansweredRequired(response)).length === 0;
  const next = response.task.isCompletable ? response.isComplete && satisfied : satisfied;
  if (next === response.isComplete) return;
  await prisma.assessmentTaskResponse.update({
    where: { id: response.id },
    data: next
      ? { isComplete: true, completedAt: new Date(), completedById: actorUserId }
      : { isComplete: false, completedAt: null, completedById: null },
  });
}

/** Marks a completable task's response complete or not complete. */
export async function setTaskResponseComplete(
  ctx: SessionContext,
  assessmentId: string,
  responseId: string,
  complete: boolean,
) {
  const { assessment, response } = await loadResponse(ctx, assessmentId, responseId);
  requireWritable(ctx, assessment);
  if (!response.task.isCompletable) {
    throw new ApiError(400, `"${response.task.name}" completes itself when its required questions are answered`);
  }
  if (complete) {
    const missing = await unansweredRequired(response);
    if (missing.length > 0) {
      throw new ApiError(400, `Answer the required questions first: ${missing.map((q) => q.prompt).join("; ")}`);
    }
  }
  return prisma.assessmentTaskResponse.update({
    where: { id: response.id },
    data: complete
      ? { isComplete: true, completedAt: new Date(), completedById: ctx.userId }
      : { isComplete: false, completedAt: null, completedById: null },
  });
}

/**
 * Removes one repeat of a repeatable task, with its answers.
 *
 * The photos stay: evidence is the record of what was seen, and its link to
 * the deleted answer is cleared rather than the file going with it. Condition
 * changes already recorded from those answers stay in the asset's history,
 * which is append-only.
 */
export async function deleteTaskResponse(ctx: SessionContext, assessmentId: string, responseId: string) {
  const { assessment, response } = await loadResponse(ctx, assessmentId, responseId);
  requireWritable(ctx, assessment);
  if (!response.task.isRepeatable) {
    throw new ApiError(400, `"${response.task.name}" is not repeatable; clear its answers instead`);
  }
  await prisma.assessmentTaskResponse.delete({ where: { id: response.id } });
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export interface SaveAnswerInput {
  questionId: string;
  /** Which response of the question's task. Omitted: the task's first response, created if needed. */
  taskResponseId?: string | null;
  assetId?: string | null;
  textValue?: string | null;
  numberValue?: number | null;
  boolValue?: boolean | null;
  conditionValue?: number | null;
  selectValues?: string[];
}

/**
 * Saves one answer.
 *
 * A CONDITION answer against an asset routes through the same
 * `recordAssetConditionChange` used everywhere else, so condition history,
 * the asset and property health, the event feed and the dashboard all update
 * from one write — no separate assessment-only path (spec §12).
 */
export async function saveAnswer(ctx: SessionContext, assessmentId: string, input: SaveAnswerInput) {
  const assessment = await loadAssessment(ctx, assessmentId);
  requireWritable(ctx, assessment);

  const question = await prisma.assessmentQuestion.findFirst({
    where: { id: input.questionId, section: { templateId: assessment.templateId } },
  });
  if (!question) throw new ApiError(400, "Invalid questionId for this assessment's template");

  let taskResponseId: string | null = null;
  if (question.taskId) {
    if (input.taskResponseId) {
      const response = await prisma.assessmentTaskResponse.findFirst({
        where: { id: input.taskResponseId, assessmentId: assessment.id, taskId: question.taskId },
      });
      if (!response) throw new ApiError(400, "That task response is not this question's task on this assessment");
      taskResponseId = response.id;
    } else {
      taskResponseId = (await firstResponse(assessment.id, question.taskId)).id;
    }
  } else if (input.taskResponseId) {
    throw new ApiError(400, "This question is not part of a task");
  }

  if (input.assetId) {
    const asset = await prisma.asset.findFirst({
      where: { id: input.assetId, propertyId: assessment.propertyId },
      select: { id: true },
    });
    if (!asset) throw new ApiError(400, "That asset is not on this assessment's property");
  }

  await markStarted(assessment);

  // Not `upsert` against the compound unique: two of its columns are
  // nullable, and Postgres treats NULLs as distinct, so the constraint would
  // not catch the duplicate an upsert relies on it to find.
  const where = {
    assessmentId: assessment.id,
    questionId: question.id,
    assetId: input.assetId ?? null,
    taskResponseId,
  };
  const data = {
    textValue: input.textValue ?? null,
    numberValue: input.numberValue ?? null,
    boolValue: input.boolValue ?? null,
    conditionValue: input.conditionValue ?? null,
    selectValues: input.selectValues ?? [],
  };
  const existing = await prisma.assessmentAnswer.findFirst({ where });
  const answer = existing
    ? await prisma.assessmentAnswer.update({ where: { id: existing.id }, data })
    : await prisma.assessmentAnswer.create({ data: { ...where, ...data } });

  if (taskResponseId) await refreshCompletion(taskResponseId, ctx.userId);

  if (question.type === "CONDITION" && input.assetId && input.conditionValue !== undefined && input.conditionValue !== null) {
    await recordAssetConditionChange({
      assetId: input.assetId,
      newScore: input.conditionValue,
      changedByUserId: ctx.userId,
      source: "ASSESSMENT",
      reason: `Assessment answer: ${question.prompt}`,
      validationStatus: "HUMAN_OBSERVED",
    });
  }

  return answer;
}

/**
 * Checks that a file may be attached to an assessment answer, and returns the
 * assessment it belongs to. Called by evidence registration, so a photo can
 * only land on an answer the uploader could have written, on the same
 * property the photo says it was taken at.
 */
export async function assertAnswerAttachable(
  ctx: SessionContext,
  answerId: string,
  propertyId: string | null,
): Promise<{ assessmentId: string }> {
  const answer = await prisma.assessmentAnswer.findFirst({
    where: { id: answerId, assessment: { organizationId: ctx.organizationId, property: propertyScopeWhere(ctx) } },
    include: { assessment: true },
  });
  if (!answer) throw new ApiError(400, "Invalid assessmentAnswerId, or you don't have access to it");
  if (propertyId !== answer.assessment.propertyId) {
    throw new ApiError(400, "A file for an assessment answer must be on that assessment's property");
  }
  requireWritable(ctx, answer.assessment);
  return { assessmentId: answer.assessmentId };
}

/** Called after a file is attached to an answer: a photo can complete its task. */
export async function afterAnswerFileAttached(answerId: string, actorUserId: string) {
  const answer = await prisma.assessmentAnswer.findUnique({ where: { id: answerId }, select: { taskResponseId: true } });
  if (answer?.taskResponseId) await refreshCompletion(answer.taskResponseId, actorUserId);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Moves an assessment through its life.
 *
 * - IN_PROGRESS / COMPLETED: the inspector or a template manager.
 * - Reopening a COMPLETED one (back to IN_PROGRESS): template managers only —
 *   completion fed the health score, and the inspector undoing it alone
 *   would rewrite a result someone may already have acted on.
 * - RELEASED: template managers only, and only from COMPLETED. Final.
 */
export async function changeAssessmentStatus(ctx: SessionContext, assessmentId: string, status: AssessmentStatus) {
  const assessment = await loadAssessment(ctx, assessmentId);
  if (assessment.status === status) return assessment;

  const manager = hasPermission(ctx.role, "canManageAssessmentTemplates");
  if (assessment.status === "RELEASED") throw new ApiError(400, "A released assessment cannot change");

  if (status === "RELEASED") {
    if (!manager) throw new ApiError(403, "Only a template manager can release an assessment");
    if (assessment.status !== "COMPLETED") throw new ApiError(400, "Complete the assessment before releasing it");
  } else if (assessment.status === "COMPLETED") {
    if (!manager) throw new ApiError(403, "Only a template manager can reopen a completed assessment");
    if (status !== "IN_PROGRESS") throw new ApiError(400, "A completed assessment can only be reopened or released");
  } else {
    if (!mayWriteAssessment(ctx, assessment)) {
      throw new ApiError(403, "Only the assigned inspector or a template manager can change this assessment");
    }
    if (status === "DRAFT" && assessment.status !== "DRAFT") {
      throw new ApiError(400, "An assessment that has started cannot go back to draft");
    }
  }

  const now = new Date();
  const updated = await prisma.assessment.update({
    where: { id: assessment.id },
    data: {
      status,
      ...(status === "IN_PROGRESS" && !assessment.startedAt ? { startedAt: now } : {}),
      ...(status === "COMPLETED" ? { completedAt: now, startedAt: assessment.startedAt ?? now } : {}),
      ...(status === "RELEASED" ? { releasedAt: now } : {}),
    },
  });

  if (status === "COMPLETED" || assessment.status === "COMPLETED") {
    // Completing feeds the score; reopening withdraws it until it completes again.
    await recalculatePropertyHealth(assessment.propertyId);
  }

  const action =
    status === "COMPLETED" ? "completed" : status === "RELEASED" ? "released" : assessment.status === "COMPLETED" ? "reopened" : null;
  if (action) {
    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: `assessment.${action}`,
      entityType: "Assessment",
      entityId: assessment.id,
    });
  }
  if (status === "COMPLETED" || status === "RELEASED") {
    await emitEvent({
      organizationId: ctx.organizationId,
      propertyId: assessment.propertyId,
      type: status === "COMPLETED" ? EVENT_TYPES.ASSESSMENT_COMPLETED : EVENT_TYPES.ASSESSMENT_RELEASED,
      actorUserId: ctx.userId,
      payload: { assessmentId: assessment.id, templateName: assessment.template.name },
    });
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export const assessmentDetailInclude = {
  property: { select: { id: true, name: true } },
  inspector: { select: { id: true, name: true } },
  template: {
    include: {
      sections: {
        orderBy: { position: "asc" },
        include: {
          questions: { orderBy: { position: "asc" } },
          tasks: { orderBy: { position: "asc" }, include: { questions: { orderBy: { position: "asc" } } } },
        },
      },
    },
  },
  taskResponses: { orderBy: [{ taskId: "asc" }, { instance: "asc" }] },
  answers: {
    include: {
      evidence: {
        where: { type: { in: [...PHOTO_EVIDENCE_TYPES, "VIDEO"] } },
        select: { id: true, type: true, mimeType: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  },
} satisfies Prisma.AssessmentInclude;

export type AssessmentDetail = Prisma.AssessmentGetPayload<{ include: typeof assessmentDetailInclude }>;

export async function getAssessmentDetail(ctx: SessionContext, assessmentId: string): Promise<AssessmentDetail | null> {
  return prisma.assessment.findFirst({
    where: { AND: [{ id: assessmentId }, { organizationId: ctx.organizationId }, { property: propertyScopeWhere(ctx) }] },
    include: assessmentDetailInclude,
  });
}

/** Progress for one loaded assessment. */
export async function progressFor(assessment: AssessmentDetail): Promise<AssessmentProgress> {
  const photos = await prisma.evidence.count({
    where: { assessmentId: assessment.id, type: { in: [...PHOTO_EVIDENCE_TYPES] } },
  });
  const loose = assessment.template.sections.flatMap((s) => s.questions.filter((q) => !q.taskId));
  const looseAnswers = new Map(
    assessment.answers.filter((a) => !a.taskResponseId).map((a) => [a.questionId, a]),
  );
  return computeAssessmentProgress({
    tasks: assessment.template.sections.flatMap((s) => s.tasks),
    responses: assessment.taskResponses,
    looseQuestions: loose.map((q) => {
      const answer = looseAnswers.get(q.id);
      return { isRequired: q.isRequired, answered: isAnswered(q.type, answer, answer?.evidence.length ?? 0) };
    }),
    photos,
  });
}
