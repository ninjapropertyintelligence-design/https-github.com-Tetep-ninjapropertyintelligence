import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { createEvidence } from "@/lib/evidence-service";
import {
  addTaskResponse,
  changeAssessmentStatus,
  deleteTaskResponse,
  getAssessmentDetail,
  progressFor,
  saveAnswer,
  setTaskResponseComplete,
} from "@/lib/assessment-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Assessment tasks. What goes wrong without these rules: a repeatable task
 * that can only be answered once (three drains, one answer); a task marked
 * complete with its required photo missing; a viewer — who passes tenant
 * scope for the whole organization — answering someone else's inspection;
 * a photo filed under another building's assessment; and a released report
 * that quietly changes after the client has it.
 */

const suffix = `at${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let property: { id: string };
let otherProperty: { id: string };
let owner: { id: string };
let inspector: { id: string };
let otherInspector: { id: string };
let viewer: { id: string };
let template: { id: string };
let checkIn: { id: string; questions: Array<{ id: string; type: string }> };
let drain: { id: string; questions: Array<{ id: string; type: string; isRequired: boolean }> };
let notes: { id: string };

function ctx(userId: string, role: Role, extra: Partial<SessionContext> = {}): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Task Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
    ...extra,
  };
}
const onStore = () => ({ grants: [{ scopeType: "PROPERTY" as const, propertyId: property.id, portfolioId: null, regionId: null }] });
const asOwner = () => ctx(owner.id, Role.OWNER);
const asInspector = () => ctx(inspector.id, Role.INSPECTOR, onStore());
const asOtherInspector = () => ctx(otherInspector.id, Role.INSPECTOR, onStore());
const asViewer = () => ctx(viewer.id, Role.VIEWER);

async function newAssessment() {
  return prisma.assessment.create({
    data: { organizationId: org.id, propertyId: property.id, templateId: template.id, inspectorId: inspector.id },
  });
}

async function photoFor(answerId: string, propertyId = property.id) {
  return createEvidence(asInspector(), {
    type: "PHOTO",
    storageKey: `${propertyId}/${crypto.randomUUID()}.jpg`,
    propertyId,
    assessmentAnswerId: answerId,
  });
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `AT ${suffix}`, slug: `at-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
    });
  property = await mk("store");
  otherProperty = await mk("other");
  const user = (label: string) =>
    prisma.user.create({ data: { email: `${label}-${suffix}@example.com`, name: label, passwordHash: "x" } });
  owner = await user("owner");
  inspector = await user("inspector");
  otherInspector = await user("other-inspector");
  viewer = await user("viewer");
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });
  await prisma.membership.create({ data: { userId: viewer.id, organizationId: org.id, role: Role.VIEWER } });
  for (const u of [inspector, otherInspector]) {
    await prisma.membership.create({
      data: {
        userId: u.id,
        organizationId: org.id,
        role: Role.INSPECTOR,
        accessGrants: { create: [{ scopeType: "PROPERTY", propertyId: property.id }] },
      },
    });
  }

  template = await prisma.assessmentTemplate.create({ data: { organizationId: org.id, name: "Site survey" } });
  const section = await prisma.assessmentSection.create({ data: { templateId: template.id, name: "Exterior" } });
  const mkTask = (name: string, flags: { isRepeatable?: boolean; isCompletable?: boolean; isRequired?: boolean }) =>
    prisma.assessmentTask.create({ data: { sectionId: section.id, name, ...flags } });

  const checkInTask = await mkTask("Check-in", { isCompletable: false });
  const drainTask = await mkTask("Roof drain", { isRepeatable: true });
  await mkTask("Optional extra", { isRequired: false });

  const q = (taskId: string | null, prompt: string, type: "PHOTO" | "TEXT" | "YES_NO", isRequired = true) =>
    prisma.assessmentQuestion.create({ data: { sectionId: section.id, taskId, prompt, type, isRequired } });
  checkIn = { id: checkInTask.id, questions: [await q(checkInTask.id, "Storefront photo", "PHOTO")] };
  drain = {
    id: drainTask.id,
    questions: [await q(drainTask.id, "Drain photo", "PHOTO"), await q(drainTask.id, "Clear?", "YES_NO"), await q(drainTask.id, "Notes", "TEXT", false)],
  };
  notes = await q(null, "General notes", "TEXT", false);
});

beforeEach(async () => {
  await prisma.evidence.deleteMany({ where: { organizationId: org.id } });
  await prisma.assessment.deleteMany({ where: { organizationId: org.id } });
});

afterAll(async () => {
  await prisma.evidence.deleteMany({ where: { organizationId: org.id } });
  await prisma.assessment.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
});

describe("repeatable tasks", () => {
  it("number each repeat and keep their answers apart", async () => {
    const a = await newAssessment();
    const first = await addTaskResponse(asInspector(), a.id, { taskId: drain.id, label: "North" });
    const second = await addTaskResponse(asInspector(), a.id, { taskId: drain.id, label: "South" });
    expect([first.instance, second.instance]).toEqual([1, 2]);

    await saveAnswer(asInspector(), a.id, { questionId: drain.questions[1].id, taskResponseId: first.id, boolValue: true });
    await saveAnswer(asInspector(), a.id, { questionId: drain.questions[1].id, taskResponseId: second.id, boolValue: false });

    const answers = await prisma.assessmentAnswer.findMany({ where: { assessmentId: a.id }, orderBy: { boolValue: "asc" } });
    expect(answers.map((x) => [x.taskResponseId, x.boolValue])).toEqual([
      [second.id, false],
      [first.id, true],
    ]);
  });

  it("refuses a second response to a task that is not repeatable", async () => {
    const a = await newAssessment();
    await addTaskResponse(asInspector(), a.id, { taskId: checkIn.id });
    await expect(addTaskResponse(asInspector(), a.id, { taskId: checkIn.id })).rejects.toThrow(/not repeatable/);
  });

  it("answers the task's first response when none is named, creating it", async () => {
    const a = await newAssessment();
    await saveAnswer(asInspector(), a.id, { questionId: drain.questions[1].id, boolValue: true });
    const responses = await prisma.assessmentTaskResponse.findMany({ where: { assessmentId: a.id } });
    expect(responses.map((r) => r.instance)).toEqual([1]);
    expect((await prisma.assessment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("IN_PROGRESS");
  });

  it("rejects a response that belongs to a different task", async () => {
    const a = await newAssessment();
    const checkInResponse = await addTaskResponse(asInspector(), a.id, { taskId: checkIn.id });
    await expect(
      saveAnswer(asInspector(), a.id, { questionId: drain.questions[1].id, taskResponseId: checkInResponse.id, boolValue: true }),
    ).rejects.toThrow(/not this question's task/);
    await expect(
      saveAnswer(asInspector(), a.id, { questionId: notes.id, taskResponseId: checkInResponse.id, textValue: "x" }),
    ).rejects.toThrow(/not part of a task/);
  });

  it("deletes one repeat with its answers but keeps its photos", async () => {
    const a = await newAssessment();
    const r = await addTaskResponse(asInspector(), a.id, { taskId: drain.id });
    const answer = await saveAnswer(asInspector(), a.id, { questionId: drain.questions[0].id, taskResponseId: r.id });
    const file = await photoFor(answer.id);

    await deleteTaskResponse(asInspector(), a.id, r.id);
    expect(await prisma.assessmentAnswer.count({ where: { assessmentId: a.id } })).toBe(0);
    const kept = await prisma.evidence.findUniqueOrThrow({ where: { id: file.id } });
    expect(kept.assessmentAnswerId).toBeNull();
    expect(kept.assessmentId).toBe(a.id);
  });
});

describe("completion", () => {
  it("a self-completing task completes when its required photo arrives", async () => {
    const a = await newAssessment();
    const answer = await saveAnswer(asInspector(), a.id, { questionId: checkIn.questions[0].id });
    const response = await prisma.assessmentTaskResponse.findFirstOrThrow({ where: { assessmentId: a.id, taskId: checkIn.id } });
    expect(response.isComplete).toBe(false);

    await photoFor(answer.id);
    expect((await prisma.assessmentTaskResponse.findUniqueOrThrow({ where: { id: response.id } })).isComplete).toBe(true);
  });

  it("will not mark a task complete with a required answer missing", async () => {
    const a = await newAssessment();
    const r = await addTaskResponse(asInspector(), a.id, { taskId: drain.id });
    await saveAnswer(asInspector(), a.id, { questionId: drain.questions[1].id, taskResponseId: r.id, boolValue: true });
    await expect(setTaskResponseComplete(asInspector(), a.id, r.id, true)).rejects.toThrow(/Drain photo/);

    const answer = await saveAnswer(asInspector(), a.id, { questionId: drain.questions[0].id, taskResponseId: r.id });
    await photoFor(answer.id);
    expect((await setTaskResponseComplete(asInspector(), a.id, r.id, true)).isComplete).toBe(true);

    // Clearing a required answer withdraws the claim.
    await saveAnswer(asInspector(), a.id, { questionId: drain.questions[1].id, taskResponseId: r.id, boolValue: null });
    expect((await prisma.assessmentTaskResponse.findUniqueOrThrow({ where: { id: r.id } })).isComplete).toBe(false);
  });

  it("counts required tasks, responses and photos", async () => {
    const a = await newAssessment();
    const checkInAnswer = await saveAnswer(asInspector(), a.id, { questionId: checkIn.questions[0].id });
    await photoFor(checkInAnswer.id);
    await photoFor(checkInAnswer.id);
    await addTaskResponse(asInspector(), a.id, { taskId: drain.id });
    await addTaskResponse(asInspector(), a.id, { taskId: drain.id });

    const detail = await getAssessmentDetail(asInspector(), a.id);
    expect(await progressFor(detail!)).toEqual({
      requiredTasks: 2,
      requiredTasksComplete: 1,
      taskResponses: 3,
      taskResponsesComplete: 1,
      taskResponsesIncomplete: 2,
      requiredQuestions: 0,
      requiredQuestionsAnswered: 0,
      photos: 2,
    });
  });
});

describe("who may write", () => {
  it("is the assigned inspector or a template manager, not a viewer or another inspector", async () => {
    const a = await newAssessment();
    await expect(saveAnswer(asViewer(), a.id, { questionId: notes.id, textValue: "x" })).rejects.toThrow(/assigned inspector/);
    await expect(saveAnswer(asOtherInspector(), a.id, { questionId: notes.id, textValue: "x" })).rejects.toThrow(/assigned inspector/);
    await expect(changeAssessmentStatus(asViewer(), a.id, "COMPLETED")).rejects.toThrow(/assigned inspector/);
    await saveAnswer(asOwner(), a.id, { questionId: notes.id, textValue: "manager note" });
  });

  it("will not file a photo under an assessment on another property", async () => {
    const a = await newAssessment();
    const answer = await saveAnswer(asInspector(), a.id, { questionId: drain.questions[0].id });
    await expect(photoFor(answer.id, otherProperty.id)).rejects.toThrow();
    await expect(
      createEvidence(asOwner(), {
        type: "PHOTO",
        storageKey: `${otherProperty.id}/x.jpg`,
        propertyId: otherProperty.id,
        assessmentId: a.id,
      }),
    ).rejects.toThrow(/Invalid assessmentId/);
  });
});

describe("status", () => {
  it("locks answers once complete, and only a manager reopens or releases", async () => {
    const a = await newAssessment();
    await changeAssessmentStatus(asInspector(), a.id, "COMPLETED");
    await expect(saveAnswer(asInspector(), a.id, { questionId: notes.id, textValue: "late" })).rejects.toThrow(/locked/);
    await expect(changeAssessmentStatus(asInspector(), a.id, "IN_PROGRESS")).rejects.toThrow(/template manager/);
    await expect(changeAssessmentStatus(asInspector(), a.id, "RELEASED")).rejects.toThrow(/template manager/);

    const released = await changeAssessmentStatus(asOwner(), a.id, "RELEASED");
    expect(released.status).toBe("RELEASED");
    expect(released.releasedAt).not.toBeNull();
    await expect(changeAssessmentStatus(asOwner(), a.id, "IN_PROGRESS")).rejects.toThrow(/released/);
    await expect(saveAnswer(asOwner(), a.id, { questionId: notes.id, textValue: "late" })).rejects.toThrow(/locked/);
  });

  it("cannot release what is not complete", async () => {
    const a = await newAssessment();
    await expect(changeAssessmentStatus(asOwner(), a.id, "RELEASED")).rejects.toThrow(/Complete the assessment/);
  });
});
