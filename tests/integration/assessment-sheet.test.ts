import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { exportAssessmentRows, exportTemplateRows, importAnswers } from "@/lib/assessment-sheet-service";
import { changeAssessmentStatus } from "@/lib/assessment-service";
import { toCsv } from "@/lib/csv";
import { parseImportFile } from "@/lib/import/parse";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * The spreadsheet round trip. What goes wrong without these rules: a sheet
 * from one site loaded into another's assessment; half a file saved before
 * row 40 turns out to be wrong; a blank cell erasing an answer given in the
 * app; and a second panel invented on a task that only has one.
 */

const suffix = `as${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let property: { id: string };
let owner: { id: string };
let inspector: { id: string };
let template: { id: string };
let q: { notes: string; photo: string; clear: string; type: string; heater: string };

function ctx(userId: string, role: Role): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Sheet Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: [{ scopeType: "PROPERTY", propertyId: property.id, portfolioId: null, regionId: null }],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}
const asInspector = () => ctx(inspector.id, Role.INSPECTOR);
const asOwner = () => ctx(owner.id, Role.OWNER);

/** Exports, lets the test edit the rows as a person would in a spreadsheet, and parses the result back. */
async function roundTrip(assessmentId: string, edit: (rows: Array<Record<string, string | number>>) => Array<Record<string, string | number>>) {
  const { rows } = await exportAssessmentRows(asInspector(), assessmentId);
  return parseImportFile("answers.csv", Buffer.from(toCsv(edit(rows.map((r) => ({ ...r }))))));
}
const setAnswer = (questionId: string, answer: string, instance?: number) => (r: Record<string, string | number>) =>
  r["Question ID"] === questionId && (instance === undefined || r["Response #"] === instance) ? { ...r, Answer: answer } : r;

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `AS ${suffix}`, slug: `as-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  property = await prisma.property.create({
    data: { organizationId: org.id, portfolioId: pf.id, name: `site-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
  });
  owner = await prisma.user.create({ data: { email: `owner-${suffix}@example.com`, name: "owner", passwordHash: "x" } });
  inspector = await prisma.user.create({ data: { email: `insp-${suffix}@example.com`, name: "insp", passwordHash: "x" } });
  template = await prisma.assessmentTemplate.create({ data: { organizationId: org.id, name: "Survey" } });
  const section = await prisma.assessmentSection.create({ data: { templateId: template.id, name: "Roof" } });
  const drain = await prisma.assessmentTask.create({ data: { sectionId: section.id, name: "Drain", isRepeatable: true } });
  const heater = await prisma.assessmentTask.create({ data: { sectionId: section.id, name: "Heater", position: 1 } });
  const question = (data: { taskId?: string; prompt: string; type: "TEXT" | "PHOTO" | "YES_NO" | "SELECT"; options?: string[] }) =>
    prisma.assessmentQuestion.create({ data: { sectionId: section.id, taskId: data.taskId ?? null, prompt: data.prompt, type: data.type, options: data.options ?? [] } });
  q = {
    notes: (await question({ prompt: "Notes", type: "TEXT" })).id,
    photo: (await question({ taskId: drain.id, prompt: "Drain photo", type: "PHOTO" })).id,
    clear: (await question({ taskId: drain.id, prompt: "Clear?", type: "YES_NO" })).id,
    type: (await question({ taskId: drain.id, prompt: "Kind", type: "SELECT", options: ["Scupper", "Internal"] })).id,
    heater: (await question({ taskId: heater.id, prompt: "Leaking?", type: "YES_NO" })).id,
  };
});

let assessmentId: string;
beforeEach(async () => {
  await prisma.assessment.deleteMany({ where: { organizationId: org.id } });
  assessmentId = (
    await prisma.assessment.create({
      data: { organizationId: org.id, propertyId: property.id, templateId: template.id, inspectorId: inspector.id },
    })
  ).id;
});

afterAll(async () => {
  await prisma.assessment.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
});

describe("export", () => {
  it("is a complete blank form before anything is answered", async () => {
    const { rows } = await exportAssessmentRows(asInspector(), assessmentId);
    expect(rows.map((r) => [r.Task, r["Response #"], r.Question, r.Answer])).toEqual([
      ["", "", "Notes", ""],
      ["Drain", 1, "Drain photo", ""],
      ["Drain", 1, "Clear?", ""],
      ["Drain", 1, "Kind", ""],
      ["Heater", 1, "Leaking?", ""],
    ]);
  });
});

describe("import", () => {
  it("loads answers, adds a repeat from copied rows, and the export then shows them", async () => {
    const table = await roundTrip(assessmentId, (rows) => {
      const filled = rows.map(setAnswer(q.notes, "Ponding by the north wall")).map(setAnswer(q.clear, "Yes")).map(setAnswer(q.type, "scupper"));
      // A second drain: the drain rows copied with Response # 2.
      const second = filled
        .filter((r) => r.Task === "Drain")
        .map((r) => ({ ...r, "Response #": 2, "Response label": "South", Answer: r["Question ID"] === q.clear ? "No" : "" }));
      return [...filled, ...second];
    });

    const check = await importAnswers(asInspector(), assessmentId, table, { dryRun: true });
    expect(check).toMatchObject({ applied: false, saved: 4, errors: 0 });
    expect(await prisma.assessmentAnswer.count({ where: { assessmentId } })).toBe(0);

    expect(await importAnswers(asInspector(), assessmentId, table, { dryRun: false })).toMatchObject({ applied: true, saved: 4 });
    const { rows } = await exportAssessmentRows(asInspector(), assessmentId);
    expect(rows.filter((r) => r.Answer !== "").map((r) => [r.Question, r["Response #"], r["Response label"], r.Answer])).toEqual([
      ["Notes", "", "", "Ponding by the north wall"],
      ["Clear?", 1, "", "Yes"],
      ["Kind", 1, "", "Scupper"],
      ["Clear?", 2, "South", "No"],
    ]);
  });

  it("writes nothing when any row is wrong, and names every bad row", async () => {
    const table = await roundTrip(assessmentId, (rows) => [
      ...rows.map(setAnswer(q.notes, "Fine")).map(setAnswer(q.clear, "maybe")),
      { ...rows.find((r) => r["Question ID"] === q.heater)!, "Response #": 2, Answer: "No" },
    ]);
    const result = await importAnswers(asInspector(), assessmentId, table, { dryRun: false });
    expect(result.applied).toBe(false);
    expect(result.rows.filter((r) => r.status === "error").map((r) => r.message)).toEqual([
      '"maybe" is not Yes or No',
      '"Heater" is not repeatable, so it has only response 1',
    ]);
    expect(await prisma.assessmentAnswer.count({ where: { assessmentId } })).toBe(0);
  });

  it("leaves an answer given in the app alone when its cell is blank", async () => {
    const first = await roundTrip(assessmentId, (rows) => rows.map(setAnswer(q.notes, "From the app")));
    await importAnswers(asInspector(), assessmentId, first, { dryRun: false });
    const blank = await roundTrip(assessmentId, (rows) => rows.map((r) => ({ ...r, Answer: "" })).map(setAnswer(q.clear, "Yes")));
    await importAnswers(asInspector(), assessmentId, blank, { dryRun: false });
    const notes = await prisma.assessmentAnswer.findFirstOrThrow({ where: { assessmentId, questionId: q.notes } });
    expect(notes.textValue).toBe("From the app");
  });

  it("refuses another assessment's sheet, and a locked assessment", async () => {
    const other = await prisma.assessment.create({
      data: { organizationId: org.id, propertyId: property.id, templateId: template.id, inspectorId: inspector.id },
    });
    const theirs = await roundTrip(other.id, (rows) => rows.map(setAnswer(q.notes, "Wrong place")));
    const result = await importAnswers(asInspector(), assessmentId, theirs, { dryRun: true });
    expect(result.rows.filter((r) => r.status === "error").every((r) => r.message === "This row belongs to a different assessment")).toBe(true);

    await changeAssessmentStatus(asInspector(), assessmentId, "COMPLETED");
    const mine = await roundTrip(assessmentId, (rows) => rows);
    await expect(importAnswers(asInspector(), assessmentId, mine, { dryRun: true })).rejects.toThrow(/locked/);
  });

  it("exports every assessment on a template, for a manager's report", async () => {
    await prisma.assessment.create({
      data: { organizationId: org.id, propertyId: property.id, templateId: template.id, inspectorId: inspector.id },
    });
    const { rows } = await exportTemplateRows(asOwner(), template.id);
    expect(new Set(rows.map((r) => r["Assessment ID"])).size).toBe(2);
  });
});
