import type { AssessmentQuestionType } from "@/generated/prisma/client";
import type { AnswerValue } from "@/lib/assessment-progress";

/**
 * Assessments as a spreadsheet: one row per question per task response.
 *
 * The same layout goes out (export) and comes back (import), so a field team
 * without the app can download a survey, fill the Answer column, and load it
 * back. The Question ID and Response # columns are what tie a row to its
 * place; everything else is there for the person reading it. A repeatable
 * task is repeated by copying its rows with the next Response #.
 *
 * Pure — no database — so both directions are testable on their own.
 */

export const SHEET_COLUMNS = [
  "Assessment ID",
  "Property",
  "Template",
  "Section",
  "Task",
  "Response #",
  "Response label",
  "Question ID",
  "Question",
  "Type",
  "Required",
  "Answer",
  "Photos",
  "Task complete",
] as const;

export type SheetRow = Record<(typeof SHEET_COLUMNS)[number], string | number>;

/** Kinds whose answer is a file. They export a count and are never imported. */
export const FILE_QUESTION_TYPES: AssessmentQuestionType[] = ["PHOTO", "VIDEO"];

/** Separator for several choices in one cell. Not a comma: options often contain one. */
export const MULTI_SEPARATOR = "; ";

/**
 * Stops a cell being read as a formula when the file is opened in a
 * spreadsheet. An answer typed as "=HYPERLINK(...)" would otherwise run in
 * the reader's Excel. The leading apostrophe is how spreadsheets themselves
 * mark text.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** An answer as one cell. */
export function formatAnswerCell(type: AssessmentQuestionType, answer: AnswerValue | undefined): string {
  if (!answer) return "";
  switch (type) {
    case "YES_NO":
      return answer.boolValue === true ? "Yes" : answer.boolValue === false ? "No" : "";
    case "NUMBER":
      return answer.numberValue === null || answer.numberValue === undefined ? "" : String(answer.numberValue);
    case "CONDITION":
      return answer.conditionValue === null || answer.conditionValue === undefined ? "" : String(answer.conditionValue);
    case "MEASUREMENT":
      return answer.numberValue !== null && answer.numberValue !== undefined ? String(answer.numberValue) : (answer.textValue ?? "");
    case "SELECT":
    case "MULTI_SELECT":
      return Array.isArray(answer.selectValues) ? (answer.selectValues as string[]).join(MULTI_SEPARATOR) : "";
    case "PHOTO":
    case "VIDEO":
      return "";
    default:
      return answer.textValue ?? "";
  }
}

export type ParsedAnswer =
  | { ok: true; value: { textValue?: string | null; numberValue?: number | null; boolValue?: boolean | null; conditionValue?: number | null; selectValues?: string[] } }
  | { ok: false; error: string };

const YES = new Set(["yes", "y", "true", "1"]);
const NO = new Set(["no", "n", "false", "0"]);

/** Reads one Answer cell for a question of the given type. A blank cell is handled by the caller. */
export function parseAnswerCell(type: AssessmentQuestionType, raw: string, options: string[]): ParsedAnswer {
  // Undo our own formula guard on the way back in.
  const value = raw.trim().replace(/^'(?=[=+\-@])/, "");
  switch (type) {
    case "YES_NO": {
      const key = value.toLowerCase();
      if (YES.has(key)) return { ok: true, value: { boolValue: true } };
      if (NO.has(key)) return { ok: true, value: { boolValue: false } };
      return { ok: false, error: `"${raw}" is not Yes or No` };
    }
    case "NUMBER":
    case "CONDITION": {
      const n = Number(value.replace(/,/g, ""));
      if (!Number.isFinite(n)) return { ok: false, error: `"${raw}" is not a number` };
      if (type === "CONDITION") {
        if (n < 0 || n > 100) return { ok: false, error: "A condition score is 0 to 100" };
        return { ok: true, value: { conditionValue: n } };
      }
      return { ok: true, value: { numberValue: n } };
    }
    case "MEASUREMENT": {
      const n = Number(value.replace(/,/g, ""));
      return { ok: true, value: Number.isFinite(n) ? { numberValue: n } : { textValue: value } };
    }
    case "SELECT":
    case "MULTI_SELECT": {
      const picked = type === "SELECT" ? [value] : value.split(/\s*;\s*/).filter(Boolean);
      // Matched without regard to case, stored as the template spells it.
      const byKey = new Map(options.map((o) => [o.toLowerCase(), o]));
      const resolved = picked.map((p) => byKey.get(p.toLowerCase()));
      const unknown = picked.filter((_, i) => !resolved[i]);
      if (unknown.length > 0) return { ok: false, error: `Not an option: ${unknown.join(", ")} (options: ${options.join(", ")})` };
      return { ok: true, value: { selectValues: resolved as string[] } };
    }
    case "PHOTO":
    case "VIDEO":
      return { ok: false, error: "Photos and videos can't be imported from a spreadsheet; add them in the app" };
    default:
      if (value.length > 10_000) return { ok: false, error: "Longer than 10,000 characters" };
      return { ok: true, value: { textValue: value } };
  }
}

/** Reads the Response # cell: blank is the first response. */
export function parseInstance(raw: string | undefined): number | null {
  const value = (raw ?? "").trim();
  if (value === "") return 1;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : null;
}
