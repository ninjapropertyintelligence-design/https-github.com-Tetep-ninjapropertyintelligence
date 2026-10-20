import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import {
  addProjectMember,
  assertProjectForAssessment,
  createProgram,
  createProject,
  getProject,
  listProjectMembers,
  listProjects,
  setDocumentProject,
  setProjectMemberActive,
  updateProject,
} from "@/lib/project-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Projects. What goes wrong without these rules: a regional manager learning
 * of a site outside their region through its project; a project at one site
 * collecting another site's documents or assessments; anyone who can view
 * the portfolio reshaping the work; and a stranger from another organization
 * appearing on a team.
 */

const suffix = `pj${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let east: { id: string };
let west: { id: string };
let owner: { id: string };
let manager: { id: string };
let stranger: { id: string };

function ctx(userId: string, role: Role, extra: Partial<SessionContext> = {}): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Project Org",
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
const asEastManager = () =>
  ctx(manager.id, Role.REGIONAL_MANAGER, {
    grants: [{ scopeType: "PROPERTY", propertyId: east.id, portfolioId: null, regionId: null }],
  });

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `PJ ${suffix}`, slug: `pj-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `PJ2 ${suffix}`, slug: `pj2-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
    });
  east = await mk("east");
  west = await mk("west");
  const user = (label: string) =>
    prisma.user.create({ data: { email: `${label}-${suffix}@example.com`, name: label, passwordHash: "x" } });
  owner = await user("owner");
  manager = await user("manager");
  stranger = await user("stranger");
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });
  await prisma.membership.create({ data: { userId: manager.id, organizationId: org.id, role: Role.REGIONAL_MANAGER } });
  await prisma.membership.create({ data: { userId: stranger.id, organizationId: otherOrg.id, role: Role.OWNER } });
});

beforeEach(async () => {
  await prisma.project.deleteMany({ where: { organizationId: org.id } });
  await prisma.program.deleteMany({ where: { organizationId: org.id } });
  await prisma.document.deleteMany({ where: { organizationId: org.id } });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.organization.delete({ where: { id: otherOrg.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
});

describe("visibility", () => {
  it("follows the property: a scoped manager sees only projects at their sites", async () => {
    await createProject(asOwner(), { propertyId: east.id, name: "East survey" });
    const westProject = await createProject(asOwner(), { propertyId: west.id, name: "West survey" });

    const seen = await listProjects(asEastManager());
    expect(seen.items.map((p) => p.name)).toEqual(["East survey"]);
    expect(seen.total).toBe(1);
    expect(await getProject(asEastManager(), westProject.id)).toBeNull();
  });

  it("counts every status tab regardless of the one selected", async () => {
    await createProject(asOwner(), { propertyId: east.id, name: "A", status: "COMPLETED" });
    await createProject(asOwner(), { propertyId: east.id, name: "B", status: "PUBLISHED" });
    await createProject(asOwner(), { propertyId: west.id, name: "C" });

    const { items, counts, total } = await listProjects(asOwner(), { status: "COMPLETED" });
    expect(items.map((p) => p.name)).toEqual(["A"]);
    expect(counts).toEqual({ NEW: 1, IN_PROGRESS: 0, PUBLISHED: 1, COMPLETED: 1 });
    expect(total).toBe(3);
  });

  it("filters by program and search", async () => {
    const program = await createProgram(asOwner(), { name: "2026 Essential" });
    await createProject(asOwner(), { propertyId: east.id, name: "In program", programId: program.id });
    await createProject(asOwner(), { propertyId: west.id, name: "Standalone" });

    expect((await listProjects(asOwner(), { programId: program.id })).items.map((p) => p.name)).toEqual(["In program"]);
    expect((await listProjects(asOwner(), { q: "west" })).items.map((p) => p.name)).toEqual(["Standalone"]);
  });
});

describe("managing", () => {
  it("needs canManageProperties", async () => {
    await expect(createProject(asEastManager(), { propertyId: east.id, name: "Nope" })).rejects.toThrow(/canManageProperties/);
    await expect(createProgram(asEastManager(), { name: "Nope" })).rejects.toThrow(/canManageProperties/);
  });

  it("refuses an end before the start, and a duplicate program name", async () => {
    await expect(
      createProject(asOwner(), { propertyId: east.id, name: "Bad", startDate: new Date("2026-05-02"), endDate: new Date("2026-05-01") }),
    ).rejects.toThrow(/end before/);
    const p = await createProject(asOwner(), { propertyId: east.id, name: "Ok", startDate: new Date("2026-05-02") });
    await expect(updateProject(asOwner(), p.id, { endDate: new Date("2026-04-01") })).rejects.toThrow(/end before/);

    await createProgram(asOwner(), { name: "Dup" });
    await expect(createProgram(asOwner(), { name: "Dup" })).rejects.toThrow(/already exists/);
  });

  it("records status changes in the audit log", async () => {
    const p = await createProject(asOwner(), { propertyId: east.id, name: "Audited" });
    await updateProject(asOwner(), p.id, { status: "PUBLISHED" });
    const log = await prisma.auditLog.findFirst({ where: { entityId: p.id, action: "project.status_changed" } });
    expect(log?.metadata).toEqual({ from: "NEW", to: "PUBLISHED" });
  });
});

describe("team", () => {
  it("adds only this organization's people, and keeps rotated-off members as inactive", async () => {
    const p = await createProject(asOwner(), { propertyId: east.id, name: "Team" });
    await expect(addProjectMember(asOwner(), p.id, stranger.id)).rejects.toThrow(/not a member/);

    const m = await addProjectMember(asOwner(), p.id, manager.id);
    await setProjectMemberActive(asOwner(), p.id, m.id, false);
    expect((await listProjectMembers(asOwner(), p.id, { active: false })).map((x) => x.userId)).toEqual([manager.id]);
    expect(await listProjectMembers(asOwner(), p.id, { active: true })).toEqual([]);

    // Adding again brings them back rather than failing on the unique key.
    await addProjectMember(asOwner(), p.id, manager.id);
    expect((await listProjectMembers(asOwner(), p.id, { active: true })).map((x) => x.userId)).toEqual([manager.id]);
  });
});

describe("what a project can hold", () => {
  it("files only its own property's documents", async () => {
    const p = await createProject(asOwner(), { propertyId: east.id, name: "Docs" });
    const eastDoc = await prisma.document.create({ data: { organizationId: org.id, propertyId: east.id, title: "Site plan" } });
    const westDoc = await prisma.document.create({ data: { organizationId: org.id, propertyId: west.id, title: "Other plan" } });

    expect((await setDocumentProject(asOwner(), p.id, eastDoc.id, true)).projectId).toBe(p.id);
    await expect(setDocumentProject(asOwner(), p.id, westDoc.id, true)).rejects.toThrow(/own property/);
    expect((await setDocumentProject(asOwner(), p.id, eastDoc.id, false)).projectId).toBeNull();
  });

  it("takes assessments only at its own property", async () => {
    const p = await createProject(asOwner(), { propertyId: east.id, name: "Assess" });
    await assertProjectForAssessment(asOwner(), p.id, east.id);
    await expect(assertProjectForAssessment(asOwner(), p.id, west.id)).rejects.toThrow(/different property/);
  });
});
