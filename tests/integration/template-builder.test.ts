import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import {
  createTemplate,
  getTemplateDefinition,
  replaceTemplate,
  saveAsNewVersion,
  setTemplateActive,
} from "@/lib/template-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * The template builder. What goes wrong without these rules: editing a
 * template in place after inspectors have used it, so recorded answers now
 * sit under questions nobody asked; a choice question with nothing to
 * choose; and a field team still scheduling surveys on a retired version.
 */

const suffix = `tb${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let property: { id: string };
let owner: { id: string };
let inspector: { id: string };

function ctx(userId: string, role: Role): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Builder Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}
const asOwner = () => ctx(owner.id, Role.OWNER);

const survey = {
  name: "Site Survey",
  description: "Check-in to check-out",
  sections: [
    {
      name: "MEP",
      questions: [{ prompt: "General notes", type: "TEXT" as const, isRequired: false, options: [] }],
      tasks: [
        {
          name: "Electrical panel",
          isRequired: true,
          isRepeatable: true,
          isCompletable: true,
          questions: [
            { prompt: "Panel photo", type: "PHOTO" as const, isRequired: true, options: [] },
            { prompt: "Panel type", type: "SELECT" as const, isRequired: false, options: ["Main", "Sub"] },
          ],
        },
      ],
    },
  ],
};

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `TB ${suffix}`, slug: `tb-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  property = await prisma.property.create({
    data: { organizationId: org.id, portfolioId: pf.id, name: `site-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
  });
  owner = await prisma.user.create({ data: { email: `owner-${suffix}@example.com`, name: "owner", passwordHash: "x" } });
  inspector = await prisma.user.create({ data: { email: `inspector-${suffix}@example.com`, name: "inspector", passwordHash: "x" } });
});

afterAll(async () => {
  await prisma.assessment.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
});

describe("building a template", () => {
  it("round-trips sections, tasks, flags and questions in order", async () => {
    const t = await createTemplate(asOwner(), survey);
    const { definition, usedBy } = await getTemplateDefinition(asOwner(), t.id);
    expect(usedBy).toBe(0);
    expect(definition).toEqual({
      ...survey,
      sections: [
        {
          ...survey.sections[0],
          questions: [{ ...survey.sections[0].questions[0], category: null }],
          tasks: [
            {
              ...survey.sections[0].tasks[0],
              description: null,
              questions: survey.sections[0].tasks[0].questions.map((q) => ({ ...q, category: null })),
            },
          ],
        },
      ],
    });
  });

  it("explains what is wrong with an incomplete definition", async () => {
    await expect(createTemplate(asOwner(), { ...survey, sections: [] })).rejects.toThrow(/at least one section/);
    const noOptions = structuredClone(survey);
    noOptions.sections[0].tasks[0].questions[1].options = ["Only one"];
    await expect(createTemplate(asOwner(), noOptions)).rejects.toThrow(/at least two options/);
    const emptyTask = structuredClone(survey);
    emptyTask.sections[0].tasks[0].questions = [];
    await expect(createTemplate(asOwner(), emptyTask)).rejects.toThrow(/at least one question/);
  });

  it("is for template managers only", async () => {
    await expect(createTemplate(ctx(inspector.id, Role.INSPECTOR), survey)).rejects.toThrow(/canManageAssessmentTemplates/);
  });
});

describe("changing a template", () => {
  it("edits in place while unused", async () => {
    const t = await createTemplate(asOwner(), survey);
    await replaceTemplate(asOwner(), t.id, { ...survey, name: "Site Survey v1.1" });
    expect((await getTemplateDefinition(asOwner(), t.id)).definition.name).toBe("Site Survey v1.1");
    // Old structure replaced, not appended to.
    expect(await prisma.assessmentSection.count({ where: { templateId: t.id } })).toBe(1);
  });

  it("refuses in-place edits once used, and saves a new version that retires the old", async () => {
    const t = await createTemplate(asOwner(), survey);
    await prisma.assessment.create({
      data: { organizationId: org.id, propertyId: property.id, templateId: t.id, inspectorId: inspector.id },
    });
    const questionIds = (await prisma.assessmentQuestion.findMany({ where: { section: { templateId: t.id } } })).map((q) => q.id);

    await expect(replaceTemplate(asOwner(), t.id, survey)).rejects.toThrow(/new version/);

    const next = await saveAsNewVersion(asOwner(), t.id, { ...survey, name: "Site Survey v2" });
    expect(next.id).not.toBe(t.id);
    expect((await prisma.assessmentTemplate.findUniqueOrThrow({ where: { id: t.id } })).isActive).toBe(false);
    // The used template's questions are untouched.
    const after = (await prisma.assessmentQuestion.findMany({ where: { section: { templateId: t.id } } })).map((q) => q.id);
    expect(after.sort()).toEqual(questionIds.sort());

    await setTemplateActive(asOwner(), t.id, true);
    expect((await prisma.assessmentTemplate.findUniqueOrThrow({ where: { id: t.id } })).isActive).toBe(true);
  });
});
