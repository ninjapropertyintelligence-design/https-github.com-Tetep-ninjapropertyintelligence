import type { AssessmentQuestionType, AssessmentStatus } from "@/generated/prisma/client";

/**
 * How far along an assessment is, as field teams count it: required tasks
 * done, task responses done and not done, and photos taken.
 *
 * Pure — the service loads the rows and this does the arithmetic — so the
 * rules can be tested without a database and the page and the API can never
 * disagree about what "complete" means.
 */

/** Statuses after which answers are locked. Everything that reads "finished assessments" uses this. */
export const FINISHED_ASSESSMENT_STATUSES: AssessmentStatus[] = ["COMPLETED", "RELEASED"];

export function isAssessmentLocked(status: AssessmentStatus): boolean {
  return FINISHED_ASSESSMENT_STATUSES.includes(status);
}

export interface AnswerValue {
  assetId?: string | null;
  textValue?: string | null;
  numberValue?: number | null;
  boolValue?: boolean | null;
  conditionValue?: number | null;
  selectValues?: unknown;
}

/**
 * Whether one answer actually answers its question.
 *
 * A row can exist with nothing in it — a photo question's answer is created
 * before its first upload so the file has something to hang off — so the row
 * existing is not enough. A photo or video question is answered by its files,
 * not by a note.
 */
export function isAnswered(type: AssessmentQuestionType, answer: AnswerValue | undefined, fileCount = 0): boolean {
  if (type === "PHOTO" || type === "VIDEO") return fileCount > 0;
  if (!answer) return false;
  const text = typeof answer.textValue === "string" && answer.textValue.trim() !== "";
  switch (type) {
    case "YES_NO":
      return answer.boolValue !== null && answer.boolValue !== undefined;
    case "NUMBER":
      return answer.numberValue !== null && answer.numberValue !== undefined;
    case "MEASUREMENT":
      return (answer.numberValue !== null && answer.numberValue !== undefined) || text;
    case "SELECT":
    case "MULTI_SELECT":
      return Array.isArray(answer.selectValues) && answer.selectValues.length > 0;
    case "CONDITION":
      return answer.conditionValue !== null && answer.conditionValue !== undefined;
    case "ASSET":
      return !!answer.assetId || text;
    default:
      return text;
  }
}

export interface ProgressTask {
  id: string;
  isRequired: boolean;
}
export interface ProgressTaskResponse {
  taskId: string;
  isComplete: boolean;
}
export interface ProgressLooseQuestion {
  isRequired: boolean;
  answered: boolean;
}

export interface AssessmentProgress {
  requiredTasks: number;
  /** Required tasks with at least one complete response. */
  requiredTasksComplete: number;
  taskResponses: number;
  taskResponsesComplete: number;
  taskResponsesIncomplete: number;
  /** Questions asked directly in a section rather than under a task. */
  requiredQuestions: number;
  requiredQuestionsAnswered: number;
  photos: number;
}

export function computeAssessmentProgress(input: {
  tasks: ProgressTask[];
  responses: ProgressTaskResponse[];
  looseQuestions: ProgressLooseQuestion[];
  photos: number;
}): AssessmentProgress {
  const doneTasks = new Set(input.responses.filter((r) => r.isComplete).map((r) => r.taskId));
  const required = input.tasks.filter((t) => t.isRequired);
  const complete = input.responses.filter((r) => r.isComplete).length;
  const requiredLoose = input.looseQuestions.filter((q) => q.isRequired);
  return {
    requiredTasks: required.length,
    requiredTasksComplete: required.filter((t) => doneTasks.has(t.id)).length,
    taskResponses: input.responses.length,
    taskResponsesComplete: complete,
    taskResponsesIncomplete: input.responses.length - complete,
    requiredQuestions: requiredLoose.length,
    requiredQuestionsAnswered: requiredLoose.filter((q) => q.answered).length,
    photos: input.photos,
  };
}
