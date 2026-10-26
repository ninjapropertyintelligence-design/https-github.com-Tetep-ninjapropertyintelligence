import type { AssessmentDetail } from "@/lib/assessment-service";
import type { AssessmentProgress } from "@/lib/assessment-progress";
import { formatAnswerCell, FILE_QUESTION_TYPES } from "@/lib/assessment-sheet";

/**
 * What a survey report says, before anything is drawn: the assessment in
 * reading order — sections, then each task response with its answers and
 * photos. Pure, so the content can be tested without parsing a PDF, and the
 * PDF renderer only decides layout.
 */

export interface ReportQuestion {
  prompt: string;
  required: boolean;
  /** The answer as text; null when unanswered. Photo questions answer with `photoIds`. */
  answer: string | null;
  isFileQuestion: boolean;
  photoIds: string[];
}

export interface ReportTaskResponse {
  taskName: string;
  /** "#2 South drain", or "" for a task answered once. */
  heading: string;
  complete: boolean;
  questions: ReportQuestion[];
}

export interface ReportSection {
  name: string;
  questions: ReportQuestion[];
  tasks: ReportTaskResponse[];
}

export interface AssessmentReportModel {
  title: string;
  propertyName: string;
  inspectorName: string;
  status: string;
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  releasedAt: Date | null;
  progress: AssessmentProgress;
  sections: ReportSection[];
  /** Tasks with no response yet, listed so a reader can see what was not done. */
  notStarted: string[];
}

export function buildAssessmentReportModel(assessment: AssessmentDetail, progress: AssessmentProgress): AssessmentReportModel {
  const answers = new Map(assessment.answers.map((a) => [`${a.questionId}|${a.taskResponseId ?? ""}`, a]));
  const notStarted: string[] = [];

  const question = (q: AssessmentDetail["template"]["sections"][number]["questions"][number], responseId: string | null): ReportQuestion => {
    const answer = answers.get(`${q.id}|${responseId ?? ""}`);
    const isFileQuestion = FILE_QUESTION_TYPES.includes(q.type);
    const text = isFileQuestion ? "" : formatAnswerCell(q.type, answer);
    return {
      prompt: q.prompt,
      required: q.isRequired,
      answer: text === "" ? null : text,
      isFileQuestion,
      photoIds: (answer?.evidence ?? []).filter((e) => e.type === "PHOTO" || e.type === "IMAGE_360").map((e) => e.id),
    };
  };

  const sections = assessment.template.sections.map((section) => {
    const tasks: ReportTaskResponse[] = [];
    for (const task of section.tasks) {
      const responses = assessment.taskResponses.filter((r) => r.taskId === task.id);
      if (responses.length === 0) {
        notStarted.push(`${section.name} — ${task.name}${task.isRequired ? " (required)" : ""}`);
        continue;
      }
      for (const response of responses) {
        tasks.push({
          taskName: task.name,
          heading: task.isRepeatable || responses.length > 1 ? `#${response.instance}${response.label ? ` ${response.label}` : ""}` : "",
          complete: response.isComplete,
          questions: task.questions.map((q) => question(q, response.id)),
        });
      }
    }
    return {
      name: section.name,
      questions: section.questions.filter((q) => !q.taskId).map((q) => question(q, null)),
      tasks,
    };
  });

  return {
    title: assessment.template.name,
    propertyName: assessment.property.name,
    inspectorName: assessment.inspector.name,
    status: assessment.status,
    scheduledFor: assessment.scheduledFor,
    startedAt: assessment.startedAt,
    completedAt: assessment.completedAt,
    releasedAt: assessment.releasedAt,
    progress,
    sections,
    notStarted,
  };
}

/** Every photo the report would show, in order — so the caller can load them once, under one cap. */
export function reportPhotoIds(model: AssessmentReportModel): string[] {
  return model.sections.flatMap((s) => [...s.questions, ...s.tasks.flatMap((t) => t.questions)].flatMap((q) => q.photoIds));
}

/** PDF can embed only JPEG and PNG; told apart by their bytes, not by the recorded type. */
export function embeddableImageKind(bytes: Buffer): "jpeg" | "png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  return null;
}
