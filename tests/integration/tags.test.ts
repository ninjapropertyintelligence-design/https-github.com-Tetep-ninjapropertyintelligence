import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import {
  addEvidenceComment,
  addStandardTagTypes,
  createTagType,
  createTagValue,
  deleteEvidenceComment,
  deleteTagValue,
  getVocabulary,
  setEvidenceFlag,
  setEvidenceTags,
  tagUsage,
} from "@/lib/tag-service";
import { addTaskResponse, saveAnswer, setTaskResponseTags } from "@/lib/assessment-service";
import { createEvidence } from "@/lib/evidence-service";
import { createTemplate } from "@/lib/template-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Tags. What goes wrong without these rules: a photo filed at two Levels; a
 * building's "Mezzanine" tag offered at every other site; a survey's photos
 * arriving untagged though the task said what they were; and a viewer
 * re-filing everyone's media.
 */

const suffix = `tg${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let store: { id: string };
let otherStore: { id: string };
let owner: { id: string };
let inspector: { id: string };
let viewer: { id: string };

function ctx(userId: string, role: Role, extra: Partial<SessionContext> = {}): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Tag Org",
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
const asOwner = () => ctx(owner.id, Role.OWNER);
const asInspector = () =>
  ctx(inspector.id, Role.INSPECTOR, { grants: [{ scopeType: "PROPERTY", propertyId: store.id, portfolioId: null, regionId: null }] });
const asViewer = () => ctx(viewer.id, Role.VIEWER);

async function value(typeName: string, valueName: string) {
  const vocabulary = await getVocabulary(asOwner(), store.id);
  const type = vocabulary.find((t) => t.name === typeName)!;
  return type.values.find((v) => v.name === valueName)!.id;
}

async function photo(propertyId = store.id) {
  return createEvidence(asOwner(), { type: "PHOTO", storageKey: `${org.id}/${crypto.randomUUID()}.jpg`, propertyId });
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `TG ${suffix}`, slug: `tg-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
    });
  store = await mk("store");
  otherStore = await mk("other");
  const user = (label: string) => prisma.user.create({ data: { email: `${label}-${suffix}@example.com`, name: label, passwordHash: "x" } });
  owner = await user("owner");
  inspector = await user("inspector");
  viewer = await user("viewer");
  await addStandardTagTypes(asOwner());
});

afterAll(async () => {
  await prisma.evidence.deleteMany({ where: { organizationId: org.id } });
  await prisma.assessment.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
});

describe("vocabulary", () => {
  it("starts from the standard types, and adding them again changes nothing", async () => {
    const before = await getVocabulary(asOwner());
    expect(before.map((t) => t.name)).toEqual(["Level", "Area", "Type", "Category", "Tag"]);
    await addStandardTagTypes(asOwner());
    const after = await getVocabulary(asOwner());
    expect(after.flatMap((t) => t.values).length).toBe(before.flatMap((t) => t.values).length);
  });

  it("offers a property's own value only at that property", async () => {
    const level = (await getVocabulary(asOwner())).find((t) => t.name === "Level")!;
    await createTagValue(asOwner(), { tagTypeId: level.id, name: "Mezzanine", propertyId: store.id });
    const names = async (propertyId: string) => (await getVocabulary(asOwner(), propertyId)).find((t) => t.name === "Level")!.values.map((v) => v.name);
    expect(await names(store.id)).toContain("Mezzanine");
    expect(await names(otherStore.id)).not.toContain("Mezzanine");

    const mezzanine = await value("Level", "Mezzanine");
    const elsewhere = await photo(otherStore.id);
    await expect(setEvidenceTags(asOwner(), elsewhere.id, [mezzanine])).rejects.toThrow(/different property/);
  });

  it("refuses duplicate names and non-managers", async () => {
    const level = (await getVocabulary(asOwner())).find((t) => t.name === "Level")!;
    await expect(createTagValue(asOwner(), { tagTypeId: level.id, name: "roof" })).rejects.toThrow(/already exists/);
    await expect(createTagType(asOwner(), { name: "level" })).rejects.toThrow(/already exists/);
    await expect(createTagType(asInspector(), { name: "Condition" })).rejects.toThrow(/canManageProperties/);
  });
});

describe("tagging photos", () => {
  it("keeps one value per single-value type, several for multi-value ones", async () => {
    const p = await photo();
    await expect(setEvidenceTags(asOwner(), p.id, [await value("Level", "Roof"), await value("Level", "Ground")])).rejects.toThrow(/Choose one Level/);

    const tagType = (await getVocabulary(asOwner())).find((t) => t.name === "Tag")!;
    const rust = await createTagValue(asOwner(), { tagTypeId: tagType.id, name: "Rust" });
    const leak = await createTagValue(asOwner(), { tagTypeId: tagType.id, name: "Leak" });
    const saved = await setEvidenceTags(asOwner(), p.id, [await value("Level", "Roof"), rust.id, leak.id]);
    expect(saved).toHaveLength(3);
    expect(await tagUsage(asOwner(), { tagValueId: rust.id })).toEqual({ photos: 1, responses: 0 });

    await deleteTagValue(asOwner(), rust.id);
    expect(await prisma.evidenceTag.count({ where: { evidenceId: p.id } })).toBe(2);
  });

  it("lets a viewer comment but not re-file or flag", async () => {
    const p = await photo();
    await expect(setEvidenceTags(asViewer(), p.id, [await value("Area", "Exterior")])).rejects.toThrow(/canUploadEvidence/);
    await expect(setEvidenceFlag(asViewer(), p.id, true)).rejects.toThrow(/canUploadEvidence/);
    const comment = await addEvidenceComment(asViewer(), p.id, "North unit, not the south one");
    await expect(deleteEvidenceComment(asInspector(), comment.id)).rejects.toThrow(/Photo not found|Only the person/);
    await deleteEvidenceComment(asViewer(), comment.id);

    const flagged = await setEvidenceFlag(asInspector(), p.id, true);
    expect(flagged.isFlagged).toBe(true);
  });
});

describe("survey photos are filed by their task", () => {
  it("gives a new response its task's default tags, and its photos inherit the response's", async () => {
    const electrical = await value("Category", "Electrical");
    const template = await createTemplate(asOwner(), {
      name: `Survey ${suffix}`,
      sections: [
        {
          name: "MEP",
          tasks: [
            {
              name: "Electrical panel",
              isRepeatable: true,
              defaultTagValueIds: [electrical],
              questions: [{ prompt: "Panel photo", type: "PHOTO", isRequired: true }],
            },
          ],
        },
      ],
    });
    const task = await prisma.assessmentTask.findFirstOrThrow({ where: { section: { templateId: template.id } } });
    const question = await prisma.assessmentQuestion.findFirstOrThrow({ where: { taskId: task.id } });
    const assessment = await prisma.assessment.create({
      data: { organizationId: org.id, propertyId: store.id, templateId: template.id, inspectorId: inspector.id },
    });

    const response = await addTaskResponse(asInspector(), assessment.id, { taskId: task.id });
    expect((await prisma.taskResponseTag.findMany({ where: { taskResponseId: response.id } })).map((t) => t.tagValueId)).toEqual([electrical]);

    // The inspector adds where it is; the photo arrives with all of it.
    const roof = await value("Level", "Roof");
    await setTaskResponseTags(asInspector(), assessment.id, response.id, [electrical, roof]);
    const answer = await saveAnswer(asInspector(), assessment.id, { questionId: question.id, taskResponseId: response.id });
    const p = await createEvidence(asInspector(), {
      type: "PHOTO",
      storageKey: `${org.id}/${crypto.randomUUID()}.jpg`,
      propertyId: store.id,
      assessmentAnswerId: answer.id,
    });
    const tags = (await prisma.evidenceTag.findMany({ where: { evidenceId: p.id } })).map((t) => t.tagValueId).sort();
    expect(tags).toEqual([electrical, roof].sort());
  });

  it("will not take a property's own tag as a template default", async () => {
    const mezzanine = await value("Level", "Mezzanine");
    await expect(
      createTemplate(asOwner(), {
        name: `Bad ${suffix}`,
        sections: [{ name: "S", tasks: [{ name: "T", defaultTagValueIds: [mezzanine], questions: [{ prompt: "Q", type: "TEXT" }] }] }],
      }),
    ).rejects.toThrow(/Task "T"/);
  });
});
