import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { addTaskResponse, saveAnswer } from "@/lib/assessment-service";
import { createEvidence, createEvidenceBatch } from "@/lib/evidence-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Device-made ids. What goes wrong without them: a phone that loses signal
 * mid-upload retries and the survey gets the same drain twice, the same
 * photo twice, and the 360 meter charges twice.
 */

const suffix = `ci${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let property: { id: string };
let inspector: { id: string };
let other: { id: string };
let assessmentId: string;
let drainTask: { id: string };
let heaterTask: { id: string };
let clearQuestion: { id: string };

function ctx(userId: string): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Client Id Org",
    membershipId: "irrelevant",
    role: Role.INSPECTOR,
    vendorId: null,
    grants: [{ scopeType: "PROPERTY", propertyId: property.id, portfolioId: null, regionId: null }],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}
const id = () => crypto.randomUUID();

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `CI ${suffix}`, slug: `ci-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  property = await prisma.property.create({
    data: { organizationId: org.id, portfolioId: pf.id, name: `site-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
  });
  inspector = await prisma.user.create({ data: { email: `insp-${suffix}@example.com`, name: "insp", passwordHash: "x" } });
  other = await prisma.user.create({ data: { email: `other-${suffix}@example.com`, name: "other", passwordHash: "x" } });
  const template = await prisma.assessmentTemplate.create({ data: { organizationId: org.id, name: "T" } });
  const section = await prisma.assessmentSection.create({ data: { templateId: template.id, name: "S" } });
  drainTask = await prisma.assessmentTask.create({ data: { sectionId: section.id, name: "Drain", isRepeatable: true } });
  heaterTask = await prisma.assessmentTask.create({ data: { sectionId: section.id, name: "Heater", isRepeatable: true } });
  clearQuestion = await prisma.assessmentQuestion.create({ data: { sectionId: section.id, taskId: drainTask.id, prompt: "Clear?", type: "YES_NO" } });
  assessmentId = (
    await prisma.assessment.create({ data: { organizationId: org.id, propertyId: property.id, templateId: template.id, inspectorId: inspector.id } })
  ).id;
});

afterAll(async () => {
  await prisma.evidence.deleteMany({ where: { organizationId: org.id } });
  await prisma.assessment.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
});

describe("retried creates", () => {
  it("return the same task response instead of adding a repeat", async () => {
    const clientId = id();
    const first = await addTaskResponse(ctx(inspector.id), assessmentId, { taskId: drainTask.id, clientId });
    const retry = await addTaskResponse(ctx(inspector.id), assessmentId, { taskId: drainTask.id, clientId });
    expect(retry.id).toBe(first.id);
    expect(await prisma.assessmentTaskResponse.count({ where: { assessmentId, taskId: drainTask.id } })).toBe(1);
    await expect(addTaskResponse(ctx(inspector.id), assessmentId, { taskId: heaterTask.id, clientId })).rejects.toThrow(/different task/);
  });

  it("refuse an answer id reused for a different answer", async () => {
    const response = await addTaskResponse(ctx(inspector.id), assessmentId, { taskId: drainTask.id });
    const clientId = id();
    await saveAnswer(ctx(inspector.id), assessmentId, { questionId: clearQuestion.id, taskResponseId: response.id, boolValue: true, clientId });
    await saveAnswer(ctx(inspector.id), assessmentId, { questionId: clearQuestion.id, taskResponseId: response.id, boolValue: false, clientId });
    const second = await addTaskResponse(ctx(inspector.id), assessmentId, { taskId: drainTask.id });
    await expect(
      saveAnswer(ctx(inspector.id), assessmentId, { questionId: clearQuestion.id, taskResponseId: second.id, boolValue: true, clientId }),
    ).rejects.toThrow(/different answer/);
  });

  it("return the same photo once, and never someone else's", async () => {
    const clientId = id();
    const file = () => ({ type: "PHOTO" as const, storageKey: `${org.id}/${id()}.jpg`, propertyId: property.id, clientId });
    const first = await createEvidence(ctx(inspector.id), file());
    const retry = await createEvidence(ctx(inspector.id), file());
    expect(retry.id).toBe(first.id);
    expect(await prisma.evidence.count({ where: { organizationId: org.id, clientId } })).toBe(1);
    await expect(createEvidence(ctx(other.id), file())).rejects.toThrow(/another file/);
  });

  it("skip already-registered files when a batch is resent", async () => {
    const ids = [id(), id()];
    const batch = () => ids.map((clientId) => ({ type: "PHOTO" as const, storageKey: `${org.id}/${id()}.jpg`, propertyId: property.id, clientId }));
    const first = await createEvidenceBatch(ctx(inspector.id), batch());
    const resent = await createEvidenceBatch(ctx(inspector.id), batch());
    expect(first.created).toBe(2);
    expect(resent.ids.sort()).toEqual(first.ids.sort());
    expect(await prisma.evidence.count({ where: { organizationId: org.id, clientId: { in: ids } } })).toBe(2);
    await expect(createEvidenceBatch(ctx(other.id), batch())).rejects.toThrow(/another person's/);
  });
});
