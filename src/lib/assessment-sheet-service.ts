import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { assessmentDetailInclude, ensureTaskResponse, getAssessmentDetail, mayWriteAssessment, saveAnswer, type AssessmentDetail } from "@/lib/assessment-service";
import { isAssessmentLocked } from "@/lib/assessment-progress";
import {
  FILE_QUESTION_TYPES,
  formatAnswerCell,
  neutralizeFormula,
  parseAnswerCell,
  parseInstance,
  SHEET_COLUMNS,
  type SheetRow,
} from "@/lib/assessment-sheet";
import type { ParsedTable } from "@/lib/import/parse";

/**
 * Exporting assessments to a spreadsheet and loading answers back from one.
 * The layout is in `assessment-sheet.ts`; this is the part that reads and
 * writes the database.
 */

/** A template-wide export is a report, not a dump: past this, filter by property. */
const MAX_EXPORT_ASSESSMENTS = 500;

function rowsFor(assessment: AssessmentDetail): SheetRow[] {
  const rows: SheetRow[] = [];
  const answers = new Map(assessment.answers.map((a) => [`${a.questionId}|${a.taskResponseId ?? ""}`, a]));
  const text = (value: string | null | undefined) => neutralizeFormula(value ?? "");

  for (const section of assessment.template.sections) {
    for (const question of section.questions.filter((q) => !q.taskId)) {
      const answer = answers.get(`${question.id}|`);
      rows.push({
        "Assessment ID": assessment.id,
        Property: text(assessment.property.name),
        Template: text(assessment.template.name),
        Section: text(section.name),
        Task: "",
        "Response #": "",
        "Response label": "",
        "Question ID": question.id,
        Question: text(question.prompt),
        Type: question.type,
        Required: question.isRequired ? "Yes" : "No",
        Answer: text(formatAnswerCell(question.type, answer)),
        Photos: answer?.evidence.length ?? 0,
        "Task complete": "",
      });
    }
    for (const task of section.tasks) {
      const responses = assessment.taskResponses.filter((r) => r.taskId === task.id);
      // A task nobody has started still gets its rows, as response 1, so
      // the sheet is a complete blank form and not just a record of what
      // was done.
      const instances = responses.length > 0 ? responses : [{ id: null, instance: 1, label: null, isComplete: false }];
      for (const response of instances) {
        for (const question of task.questions) {
          const answer = response.id ? answers.get(`${question.id}|${response.id}`) : undefined;
          rows.push({
            "Assessment ID": assessment.id,
            Property: text(assessment.property.name),
            Template: text(assessment.template.name),
            Section: text(section.name),
            Task: text(task.name),
            "Response #": response.instance,
            "Response label": text(response.label),
            "Question ID": question.id,
            Question: text(question.prompt),
            Type: question.type,
            Required: question.isRequired ? "Yes" : "No",
            Answer: text(formatAnswerCell(question.type, answer)),
            Photos: answer?.evidence.length ?? 0,
            "Task complete": response.id ? (response.isComplete ? "Yes" : "No") : "",
          });
        }
      }
    }
  }
  return rows;
}

export async function exportAssessmentRows(ctx: SessionContext, assessmentId: string): Promise<{ rows: SheetRow[]; name: string }> {
  const assessment = await getAssessmentDetail(ctx, assessmentId);
  if (!assessment) throw new ApiError(404, "Assessment not found");
  return { rows: rowsFor(assessment), name: `${assessment.template.name}-${assessment.property.name}` };
}

/** Every in-scope assessment run on one template, one block of rows each. */
export async function exportTemplateRows(ctx: SessionContext, templateId: string): Promise<{ rows: SheetRow[]; name: string }> {
  const template = await prisma.assessmentTemplate.findFirst({ where: { id: templateId, organizationId: ctx.organizationId } });
  if (!template) throw new ApiError(404, "Template not found");
  const where = { templateId: template.id, organizationId: ctx.organizationId, property: propertyScopeWhere(ctx) };
  const count = await prisma.assessment.count({ where });
  if (count > MAX_EXPORT_ASSESSMENTS) {
    throw new ApiError(400, `${count} assessments use this template; export them from each property, or narrow the template`);
  }
  const assessments = await prisma.assessment.findMany({ where, include: assessmentDetailInclude, orderBy: { createdAt: "asc" } });
  return { rows: assessments.flatMap(rowsFor), name: template.name };
}

export interface ImportRowResult {
  rowNumber: number;
  status: "save" | "skip" | "error";
  message: string;
}

export interface AnswerImportResult {
  applied: boolean;
  saved: number;
  skipped: number;
  errors: number;
  rows: ImportRowResult[];
}

/**
 * Loads answers from a filled-in sheet into one assessment.
 *
 * All or nothing: every row is checked before anything is written, and one
 * bad row means nothing is saved — a half-loaded survey is harder to fix
 * than a file with a mistake in it. A blank Answer leaves the question as it
 * is rather than clearing it, so a partly filled sheet does not erase work
 * done in the app. `dryRun` checks without writing.
 */
export async function importAnswers(
  ctx: SessionContext,
  assessmentId: string,
  table: ParsedTable,
  options: { dryRun: boolean },
): Promise<AnswerImportResult> {
  const assessment = await getAssessmentDetail(ctx, assessmentId);
  if (!assessment) throw new ApiError(404, "Assessment not found");
  if (!mayWriteAssessment(ctx, assessment)) {
    throw new ApiError(403, "Only the assigned inspector or a template manager can change this assessment");
  }
  if (isAssessmentLocked(assessment.status)) {
    throw new ApiError(400, `Assessment is ${assessment.status.toLowerCase()} and its answers are locked`);
  }

  const column = (name: (typeof SHEET_COLUMNS)[number]) => table.headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const questionCol = column("Question ID");
  const answerCol = column("Answer");
  if (questionCol < 0 || answerCol < 0) {
    throw new ApiError(400, 'The sheet needs "Question ID" and "Answer" columns — start from this assessment\'s export');
  }
  const assessmentCol = column("Assessment ID");
  const instanceCol = column("Response #");
  const labelCol = column("Response label");

  const questions = new Map(
    assessment.template.sections.flatMap((s) => [...s.questions, ...s.tasks.flatMap((t) => t.questions)]).map((q) => [q.id, q]),
  );
  const taskNames = new Map(assessment.template.sections.flatMap((s) => s.tasks.map((t) => [t.id, t.name] as const)));
  const repeatable = new Set(assessment.template.sections.flatMap((s) => s.tasks.filter((t) => t.isRepeatable).map((t) => t.id)));

  type Planned = { rowNumber: number; questionId: string; taskId: string | null; instance: number; label: string | null; value: Record<string, unknown> };
  const planned: Planned[] = [];
  const results: ImportRowResult[] = [];
  const seen = new Map<string, number>();

  table.rows.forEach((cells, index) => {
    const rowNumber = index + 2; // the header is row 1, as the spreadsheet numbers it
    const cell = (col: number) => (col >= 0 ? (cells[col] ?? "").trim() : "");
    const fail = (message: string) => results.push({ rowNumber, status: "error", message });

    const sheetAssessment = cell(assessmentCol);
    if (sheetAssessment && sheetAssessment !== assessment.id) {
      return fail("This row belongs to a different assessment");
    }
    const question = questions.get(cell(questionCol));
    if (!question) return fail(`"${cell(questionCol)}" is not a question in this assessment's template`);
    const raw = cell(answerCol);
    if (raw === "") return results.push({ rowNumber, status: "skip", message: "No answer" });
    if (FILE_QUESTION_TYPES.includes(question.type)) {
      return results.push({ rowNumber, status: "skip", message: "Photo and video answers are added in the app" });
    }

    const instance = question.taskId ? parseInstance(cell(instanceCol)) : 1;
    if (instance === null) return fail(`"${cell(instanceCol)}" is not a response number`);
    if (question.taskId && instance > 1 && !repeatable.has(question.taskId)) {
      return fail(`"${taskNames.get(question.taskId)}" is not repeatable, so it has only response 1`);
    }

    const parsed = parseAnswerCell(question.type, raw, Array.isArray(question.options) ? (question.options as string[]) : []);
    if (!parsed.ok) return fail(parsed.error);

    const key = `${question.id}|${instance}`;
    if (seen.has(key)) return fail(`Answers the same question as row ${seen.get(key)}`);
    seen.set(key, rowNumber);

    planned.push({
      rowNumber,
      questionId: question.id,
      taskId: question.taskId,
      instance,
      label: question.taskId ? cell(labelCol).replace(/^'(?=[=+\-@])/, "") || null : null,
      value: parsed.value,
    });
    results.push({ rowNumber, status: "save", message: question.taskId ? `${taskNames.get(question.taskId)} #${instance}` : "Saved" });
  });

  const errors = results.filter((r) => r.status === "error").length;
  const summary = {
    saved: planned.length,
    skipped: results.filter((r) => r.status === "skip").length,
    errors,
    rows: results.sort((a, b) => a.rowNumber - b.rowNumber),
  };
  if (errors > 0 || options.dryRun) return { applied: false, ...summary };

  // Responses first, once each, then the answers into them.
  const responseIds = new Map<string, string>();
  for (const p of planned) {
    if (!p.taskId) continue;
    const key = `${p.taskId}|${p.instance}`;
    if (responseIds.has(key)) continue;
    const response = await ensureTaskResponse(ctx, assessment.id, { taskId: p.taskId, instance: p.instance, label: p.label });
    responseIds.set(key, response.id);
  }
  for (const p of planned) {
    await saveAnswer(ctx, assessment.id, {
      questionId: p.questionId,
      taskResponseId: p.taskId ? responseIds.get(`${p.taskId}|${p.instance}`) : null,
      ...p.value,
    });
  }

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "assessment.answers_imported",
    entityType: "Assessment",
    entityId: assessment.id,
    metadata: { saved: summary.saved, skipped: summary.skipped },
  });
  return { applied: true, ...summary };
}
