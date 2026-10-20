import { describe, expect, it } from "vitest";
import { computeAssessmentProgress, isAnswered, isAssessmentLocked } from "@/lib/assessment-progress";

describe("isAnswered", () => {
  it("answers a photo question with files, not with a note", () => {
    expect(isAnswered("PHOTO", { textValue: "took one" }, 0)).toBe(false);
    expect(isAnswered("PHOTO", undefined, 1)).toBe(true);
  });

  it("treats an empty row as unanswered", () => {
    expect(isAnswered("TEXT", { textValue: "   " })).toBe(false);
    expect(isAnswered("YES_NO", { boolValue: null })).toBe(false);
    expect(isAnswered("MULTI_SELECT", { selectValues: [] })).toBe(false);
  });

  it("counts false and zero as answers", () => {
    expect(isAnswered("YES_NO", { boolValue: false })).toBe(true);
    expect(isAnswered("NUMBER", { numberValue: 0 })).toBe(true);
    expect(isAnswered("CONDITION", { conditionValue: 0 })).toBe(true);
  });
});

describe("computeAssessmentProgress", () => {
  it("counts a required task done when any of its responses is complete", () => {
    const progress = computeAssessmentProgress({
      tasks: [
        { id: "a", isRequired: true },
        { id: "b", isRequired: true },
        { id: "c", isRequired: false },
      ],
      responses: [
        { taskId: "a", isComplete: false },
        { taskId: "a", isComplete: true },
        { taskId: "c", isComplete: true },
      ],
      looseQuestions: [
        { isRequired: true, answered: true },
        { isRequired: true, answered: false },
        { isRequired: false, answered: false },
      ],
      photos: 4,
    });
    expect(progress).toEqual({
      requiredTasks: 2,
      requiredTasksComplete: 1,
      taskResponses: 3,
      taskResponsesComplete: 2,
      taskResponsesIncomplete: 1,
      requiredQuestions: 2,
      requiredQuestionsAnswered: 1,
      photos: 4,
    });
  });
});

describe("isAssessmentLocked", () => {
  it("locks completed and released assessments only", () => {
    expect(["DRAFT", "IN_PROGRESS", "COMPLETED", "RELEASED"].map((s) => isAssessmentLocked(s as never))).toEqual([false, false, true, true]);
  });
});
