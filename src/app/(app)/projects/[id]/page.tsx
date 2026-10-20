import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext, can, type SessionContext } from "@/lib/session-context";
import { evidenceScopeWhere } from "@/lib/tenant-scope";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/format";
import { getProject, listProjectMembers } from "@/lib/project-service";
import { myCollections } from "@/lib/collection-service";
import { AddToCollection } from "@/components/collection/CollectionControls";
import {
  AddProjectMember,
  AttachDocument,
  DetachDocument,
  ProjectLifecycle,
  ProjectStatusSelect,
  ScheduleProjectAssessment,
  ToggleMemberActive,
} from "@/components/project/ProjectControls";

const TABS = [
  { key: "assessments", label: "Assessments" },
  { key: "media", label: "Media" },
  { key: "users", label: "Users" },
  { key: "documents", label: "Documents" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Project = NonNullable<Awaited<ReturnType<typeof getProject>>>;

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; status?: string; q?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const { id } = await params;
  const query = await searchParams;
  const project = await getProject(ctx, id);
  if (!project) notFound();
  const tab: TabKey = TABS.some((t) => t.key === query.tab) ? (query.tab as TabKey) : "assessments";
  const canManage = can(ctx, "canManageProperties");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/projects" className="text-xs text-muted hover:text-brand">
            ← Projects
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{project.name}</h1>
            <StatusBadge status={project.status} />
          </div>
          <p className="text-sm text-muted">
            <Link href={`/properties/${project.property.id}`} className="hover:text-brand">
              {project.property.name}
            </Link>
            {` · ${project.property.city}, ${project.property.state}`}
            {project.program ? (
              <>
                {" · Program: "}
                <Link href={`/projects?program=${project.program.id}`} className="hover:text-brand">
                  {project.program.name}
                </Link>
              </>
            ) : null}
            {project.projectType ? ` · ${project.projectType}` : ""}
          </p>
          <p className="text-xs text-muted">
            {project.startDate || project.endDate ? `${formatDate(project.startDate)} – ${formatDate(project.endDate)}` : "No dates set"}
            {project.createdBy ? ` · Created by ${project.createdBy.name}` : ""}
          </p>
          {project.description ? <p className="mt-2 max-w-2xl text-sm text-foreground">{project.description}</p> : null}
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-start gap-2">
            <ProjectStatusSelect projectId={project.id} status={project.status} />
            <ProjectLifecycle projectId={project.id} archived={!!project.archivedAt} name={project.name} />
          </div>
        ) : null}
      </div>

      {project.archivedAt ? (
        <p className="rounded-lg border border-border bg-zinc-50 px-3 py-2 text-sm text-muted">
          Archived {formatDate(project.archivedAt)}. It is hidden from project lists until restored; everything on it is kept.
        </p>
      ) : null}

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/projects/${project.id}?tab=${t.key}`}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${
              tab === t.key ? "border-brand text-brand" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "assessments" ? <AssessmentsTab ctx={ctx} project={project} canManage={canManage} /> : null}
      {tab === "media" ? <MediaTab ctx={ctx} project={project} /> : null}
      {tab === "users" ? <UsersTab ctx={ctx} project={project} canManage={canManage} status={query.status} q={query.q} /> : null}
      {tab === "documents" ? <DocumentsTab ctx={ctx} project={project} canManage={canManage} /> : null}
    </div>
  );
}

async function AssessmentsTab({ ctx, project, canManage }: { ctx: SessionContext; project: Project; canManage: boolean }) {
  const [assessments, templates, inspectors] = await Promise.all([
    prisma.assessment.findMany({
      where: { projectId: project.id, organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        template: { select: { name: true } },
        inspector: { select: { name: true } },
        _count: { select: { taskResponses: true, evidence: true } },
      },
    }),
    canManage
      ? prisma.assessmentTemplate.findMany({ where: { organizationId: ctx.organizationId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [],
    canManage
      ? prisma.user.findMany({
          where: { memberships: { some: { organizationId: ctx.organizationId, role: { in: ["INSPECTOR", "TECHNICIAN", "FACILITIES_MANAGER", "REGIONAL_MANAGER", "PORTFOLIO_ADMIN", "OWNER"] } } } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [],
  ]);
  return (
    <div className="space-y-3">
      {canManage ? (
        <ScheduleProjectAssessment projectId={project.id} propertyId={project.property.id} templates={templates} inspectors={inspectors} />
      ) : null}
      {assessments.length === 0 ? (
        <EmptyState title="No assessments on this project" description="Assessments scheduled for this project appear here with their progress." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {assessments.map((a) => (
            <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <div>
                <Link href={`/assessments/${a.id}`} className="font-medium text-foreground hover:text-brand">
                  {a.template.name}
                </Link>
                <p className="text-xs text-muted">
                  Inspector: {a.inspector.name} · {a._count.taskResponses} task responses · {a._count.evidence} files
                </p>
              </div>
              <div className="text-right">
                <StatusBadge status={a.status} />
                <p className="mt-1 text-xs text-muted">{formatDate(a.releasedAt ?? a.completedAt ?? a.scheduledFor)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What was captured for this project: the files on its assessments. */
async function MediaTab({ ctx, project }: { ctx: SessionContext; project: Project }) {
  const [files, collections] = await Promise.all([
    prisma.evidence.findMany({
      where: { AND: [evidenceScopeWhere(ctx), { assessment: { projectId: project.id } }, { type: { in: ["PHOTO", "IMAGE_360"] } }] },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, createdAt: true },
      take: 300,
    }),
    can(ctx, "canViewPortfolio") ? myCollections(ctx) : [],
  ]);
  const canCollect = can(ctx, "canViewPortfolio");
  if (files.length === 0) {
    return <EmptyState title="No media yet" description="Photos taken on this project's assessments collect here." />;
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{files.length} photos</p>
        {canCollect ? <AddToCollection evidenceIds={files.map((f) => f.id)} collections={collections} /> : null}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
        {files.map((f) => (
          <div key={f.id} className="space-y-1">
            <a href={`/api/v1/evidence/${f.id}/content`} className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- same-origin evidence bytes, not a static asset */}
              <img src={`/api/v1/evidence/${f.id}/content`} alt={`${f.type === "IMAGE_360" ? "360° panorama" : "Photo"} from ${formatDate(f.createdAt)}`} className="aspect-square w-full rounded-lg border border-border object-cover" />
            </a>
            {canCollect ? <AddToCollection evidenceIds={[f.id]} collections={collections} compact /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

async function UsersTab({
  ctx,
  project,
  canManage,
  status,
  q,
}: {
  ctx: SessionContext;
  project: Project;
  canManage: boolean;
  status?: string;
  q?: string;
}) {
  const filter = status === "active" || status === "inactive" ? status : "all";
  const [members, all] = await Promise.all([
    listProjectMembers(ctx, project.id, { active: filter === "all" ? null : filter === "active", q: q?.trim() || null }),
    listProjectMembers(ctx, project.id),
  ]);
  const onTeam = new Set(all.map((m) => m.userId));
  const candidates = canManage
    ? (
        await prisma.user.findMany({
          where: { memberships: { some: { organizationId: ctx.organizationId } } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      ).filter((u) => !onTeam.has(u.id))
    : [];
  const counts = { all: all.length, active: all.filter((m) => m.isActive).length, inactive: all.filter((m) => !m.isActive).length };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(["all", "active", "inactive"] as const).map((f) => (
            <Link
              key={f}
              href={`/projects/${project.id}?tab=users${f === "all" ? "" : `&status=${f}`}`}
              className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${filter === f ? "border-brand bg-brand/10 text-brand" : "border-border text-muted"}`}
            >
              {f} ({counts[f]})
            </Link>
          ))}
        </div>
        <form action={`/projects/${project.id}`} className="flex gap-2">
          <input type="hidden" name="tab" value="users" />
          {filter !== "all" ? <input type="hidden" name="status" value={filter} /> : null}
          <input name="q" defaultValue={q ?? ""} placeholder="Search people" className="rounded-lg border border-border px-3 py-1.5 text-sm" />
        </form>
      </div>
      {canManage ? <AddProjectMember projectId={project.id} candidates={candidates} /> : null}
      <p className="text-xs text-muted">The team is a roster. What each person can open is still set by their role and property access.</p>
      {members.length === 0 ? (
        <EmptyState title="No one here" description={counts.all === 0 ? "Nobody is on this project's team yet." : "Nobody matches this filter."} />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <div>
                <p className="font-medium text-foreground">{m.user.name}</p>
                <p className="text-xs text-muted">
                  {m.user.email} · added {formatDate(m.addedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${m.isActive ? "text-[var(--band-good)]" : "text-muted"}`}>{m.isActive ? "Active" : "Inactive"}</span>
                {canManage ? <ToggleMemberActive projectId={project.id} memberId={m.id} isActive={m.isActive} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function DocumentsTab({ ctx, project, canManage }: { ctx: SessionContext; project: Project; canManage: boolean }) {
  const [documents, available] = await Promise.all([
    prisma.document.findMany({
      where: { projectId: project.id, organizationId: ctx.organizationId },
      orderBy: { updatedAt: "desc" },
      include: { versions: { orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true, originalFilename: true, uploadedAt: true } } },
    }),
    canManage
      ? prisma.document.findMany({
          where: { propertyId: project.property.id, organizationId: ctx.organizationId, projectId: null },
          select: { id: true, title: true },
          orderBy: { title: "asc" },
        })
      : [],
  ]);
  return (
    <div className="space-y-3">
      {canManage ? <AttachDocument projectId={project.id} documents={available} /> : null}
      {documents.length === 0 ? (
        <EmptyState
          title="No documents on this project"
          description="Upload documents on the property's Documents tab, then file them here."
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {documents.map((d) => (
            <li key={d.id} className="px-5 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{d.title}</p>
                  <p className="text-xs text-muted">
                    {d.documentType.replace(/_/g, " ")} · updated {formatDate(d.updatedAt)}
                  </p>
                </div>
                {canManage ? <DetachDocument projectId={project.id} documentId={d.id} /> : null}
              </div>
              {d.versions.length > 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted">
                    {d.versions.length} version{d.versions.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {d.versions.map((v) => (
                      <li key={v.id}>
                        v{v.versionNumber} · {v.originalFilename} · {formatDate(v.uploadedAt)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p className="text-xs text-muted">No document versions</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
