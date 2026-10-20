import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import type { Prisma, ProjectStatus } from "@/generated/prisma/client";

/**
 * Programs and projects.
 *
 * A project is one engagement at one property; a program groups projects
 * across many. A project is visible exactly when its property is — it adds
 * no access of its own — so a regional manager sees the projects in their
 * region and nobody can learn of a site through its project.
 *
 * Changing either is `canManageProperties`: setting up the work at a site is
 * the same authority as setting up the site.
 */

export const PROJECT_STATUSES: ProjectStatus[] = ["NEW", "IN_PROGRESS", "PUBLISHED", "COMPLETED"];

export function projectScopeWhere(ctx: SessionContext): Prisma.ProjectWhereInput {
  return { organizationId: ctx.organizationId, property: propertyScopeWhere(ctx) };
}

function requireManager(ctx: SessionContext) {
  if (!hasPermission(ctx.role, "canManageProperties")) {
    throw new ApiError(403, "Missing permission: canManageProperties");
  }
}

async function loadProject(ctx: SessionContext, projectId: string) {
  const project = await prisma.project.findFirst({ where: { AND: [{ id: projectId }, projectScopeWhere(ctx)] } });
  if (!project) throw new ApiError(404, "Project not found");
  return project;
}

async function assertProgram(ctx: SessionContext, programId: string) {
  const program = await prisma.program.findFirst({ where: { id: programId, organizationId: ctx.organizationId } });
  if (!program) throw new ApiError(400, "Invalid programId");
}

function assertDates(start: Date | null | undefined, end: Date | null | undefined) {
  if (start && end && end < start) throw new ApiError(400, "A project cannot end before it starts");
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export async function listPrograms(ctx: SessionContext) {
  return prisma.program.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { name: "asc" },
    include: { _count: { select: { projects: { where: { ...projectScopeWhere(ctx), archivedAt: null } } } } },
  });
}

export async function createProgram(ctx: SessionContext, input: { name: string; description?: string | null }) {
  requireManager(ctx);
  const name = input.name.trim();
  if (!name) throw new ApiError(400, "A program needs a name");
  const clash = await prisma.program.findFirst({ where: { organizationId: ctx.organizationId, name } });
  if (clash) throw new ApiError(409, `A program named "${name}" already exists`);
  return prisma.program.create({
    data: { organizationId: ctx.organizationId, name, description: input.description?.trim() || null },
  });
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectFilters {
  status?: ProjectStatus | null;
  /** Archived projects are listed only when asked for, and then only those. */
  archived?: boolean;
  programId?: string | null;
  propertyId?: string | null;
  q?: string | null;
}

export async function listProjects(ctx: SessionContext, filters: ProjectFilters = {}) {
  const base: Prisma.ProjectWhereInput = {
    AND: [
      projectScopeWhere(ctx),
      { archivedAt: filters.archived ? { not: null } : null },
      filters.programId ? { programId: filters.programId } : {},
      filters.propertyId ? { propertyId: filters.propertyId } : {},
      filters.q
        ? {
            OR: [
              { name: { contains: filters.q, mode: "insensitive" } },
              { property: { name: { contains: filters.q, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };
  // Counts per status tab ignore the status filter itself, so every tab
  // shows how many it would list.
  const [items, grouped] = await Promise.all([
    prisma.project.findMany({
      where: { AND: [base, filters.status ? { status: filters.status } : {}] },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      include: {
        property: { select: { id: true, name: true, city: true, state: true } },
        program: { select: { id: true, name: true } },
      },
      take: 200,
    }),
    prisma.project.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(PROJECT_STATUSES.map((s) => [s, 0])) as Record<ProjectStatus, number>;
  for (const g of grouped) counts[g.status] = g._count._all;
  const archivedCount = filters.archived
    ? Object.values(counts).reduce((a, b) => a + b, 0)
    : await prisma.project.count({ where: { AND: [projectScopeWhere(ctx), { archivedAt: { not: null } }] } });
  return { items, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), archivedCount };
}

export async function getProject(ctx: SessionContext, projectId: string) {
  return prisma.project.findFirst({
    where: { AND: [{ id: projectId }, projectScopeWhere(ctx)] },
    include: {
      property: { select: { id: true, name: true, city: true, state: true } },
      program: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
    },
  });
}

export interface ProjectInput {
  propertyId: string;
  name: string;
  programId?: string | null;
  projectType?: string | null;
  description?: string | null;
  status?: ProjectStatus;
  startDate?: Date | null;
  endDate?: Date | null;
}

export async function createProject(ctx: SessionContext, input: ProjectInput) {
  requireManager(ctx);
  const name = input.name.trim();
  if (!name) throw new ApiError(400, "A project needs a name");
  const property = await prisma.property.findFirst({ where: { AND: [{ id: input.propertyId }, propertyScopeWhere(ctx)] } });
  if (!property) throw new ApiError(400, "Invalid propertyId, or you don't have access to it");
  if (input.programId) await assertProgram(ctx, input.programId);
  assertDates(input.startDate, input.endDate);

  const project = await prisma.project.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: property.id,
      programId: input.programId ?? null,
      name,
      projectType: input.projectType?.trim() || null,
      description: input.description?.trim() || null,
      status: input.status ?? "NEW",
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      createdById: ctx.userId,
    },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "project.created",
    entityType: "Project",
    entityId: project.id,
  });
  return project;
}

export async function updateProject(ctx: SessionContext, projectId: string, input: Partial<Omit<ProjectInput, "propertyId">>) {
  requireManager(ctx);
  const project = await loadProject(ctx, projectId);
  if (input.programId) await assertProgram(ctx, input.programId);
  if (input.name !== undefined && !input.name.trim()) throw new ApiError(400, "A project needs a name");
  assertDates(
    input.startDate === undefined ? project.startDate : input.startDate,
    input.endDate === undefined ? project.endDate : input.endDate,
  );

  const updated = await prisma.project.update({
    where: { id: project.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.programId !== undefined ? { programId: input.programId } : {}),
      ...(input.projectType !== undefined ? { projectType: input.projectType?.trim() || null } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
    },
  });
  if (input.status && input.status !== project.status) {
    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "project.status_changed",
      entityType: "Project",
      entityId: project.id,
      metadata: { from: project.status, to: input.status },
    });
  }
  return updated;
}

/** Puts a project away, or brings it back. Nothing on it changes. */
export async function setProjectArchived(ctx: SessionContext, projectId: string, archived: boolean) {
  requireManager(ctx);
  const project = await loadProject(ctx, projectId);
  const updated = await prisma.project.update({
    where: { id: project.id },
    data: { archivedAt: archived ? (project.archivedAt ?? new Date()) : null },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: archived ? "project.archived" : "project.restored",
    entityType: "Project",
    entityId: project.id,
  });
  return updated;
}

/**
 * Deletes a project. What was done under it stays: its assessments and
 * documents are unlinked, not deleted, because they are the record of work
 * at the property whether or not the project that organized it still
 * exists. Only the project, its team roster and its grouping go.
 */
export async function deleteProject(ctx: SessionContext, projectId: string) {
  requireManager(ctx);
  const project = await loadProject(ctx, projectId);
  const [assessments, documents] = await Promise.all([
    prisma.assessment.count({ where: { projectId: project.id } }),
    prisma.document.count({ where: { projectId: project.id } }),
  ]);
  await prisma.project.delete({ where: { id: project.id } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "project.deleted",
    entityType: "Project",
    entityId: project.id,
    metadata: { name: project.name, propertyId: project.propertyId, unlinkedAssessments: assessments, unlinkedDocuments: documents },
  });
  return { unlinkedAssessments: assessments, unlinkedDocuments: documents };
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export async function listProjectMembers(ctx: SessionContext, projectId: string, filter: { active?: boolean | null; q?: string | null } = {}) {
  const project = await loadProject(ctx, projectId);
  return prisma.projectMember.findMany({
    where: {
      projectId: project.id,
      ...(filter.active === null || filter.active === undefined ? {} : { isActive: filter.active }),
      ...(filter.q
        ? {
            user: {
              OR: [
                { name: { contains: filter.q, mode: "insensitive" } },
                { email: { contains: filter.q, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    orderBy: { user: { name: "asc" } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
}

/** Adds someone from this organization to the project team, or brings them back. */
export async function addProjectMember(ctx: SessionContext, projectId: string, userId: string) {
  requireManager(ctx);
  const project = await loadProject(ctx, projectId);
  const membership = await prisma.membership.findFirst({ where: { userId, organizationId: ctx.organizationId } });
  if (!membership) throw new ApiError(400, "That person is not a member of this organization");
  return prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId } },
    create: { projectId: project.id, userId },
    update: { isActive: true },
  });
}

export async function setProjectMemberActive(ctx: SessionContext, projectId: string, memberId: string, isActive: boolean) {
  requireManager(ctx);
  const project = await loadProject(ctx, projectId);
  const member = await prisma.projectMember.findFirst({ where: { id: memberId, projectId: project.id } });
  if (!member) throw new ApiError(404, "Team member not found");
  return prisma.projectMember.update({ where: { id: member.id }, data: { isActive } });
}

// ---------------------------------------------------------------------------
// Documents and assessments
// ---------------------------------------------------------------------------

/**
 * Files a property document under one of its projects, or takes it out.
 * A document can only belong to a project on its own property.
 */
export async function setDocumentProject(ctx: SessionContext, projectId: string, documentId: string, attached: boolean) {
  requireManager(ctx);
  const project = await loadProject(ctx, projectId);
  const document = await prisma.document.findFirst({ where: { id: documentId, organizationId: ctx.organizationId } });
  if (!document) throw new ApiError(404, "Document not found");
  if (document.propertyId !== project.propertyId) {
    throw new ApiError(400, "Only a document on the project's own property can be filed under it");
  }
  if (!attached && document.projectId !== project.id) return document;
  return prisma.document.update({ where: { id: document.id }, data: { projectId: attached ? project.id : null } });
}

/** Checks a project an assessment is being scheduled under, and that it is at the assessment's property. */
export async function assertProjectForAssessment(ctx: SessionContext, projectId: string, propertyId: string) {
  const project = await loadProject(ctx, projectId);
  if (project.propertyId !== propertyId) throw new ApiError(400, "That project is at a different property");
  return project;
}
