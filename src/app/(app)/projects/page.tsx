import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere, can } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProjectTable } from "@/components/project/ProjectTable";
import { NewProjectForm } from "@/components/project/NewProjectForm";
import { listPrograms, listProjects, PROJECT_STATUSES } from "@/lib/project-service";
import type { ProjectStatus } from "@/generated/prisma/client";

const TAB_LABELS: Record<ProjectStatus, string> = {
  NEW: "New",
  IN_PROGRESS: "In Progress",
  PUBLISHED: "Published",
  COMPLETED: "Completed",
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; program?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const params = await searchParams;
  const status = PROJECT_STATUSES.includes(params.status as ProjectStatus) ? (params.status as ProjectStatus) : null;

  const [{ items, counts, total }, programs] = await Promise.all([
    listProjects(ctx, { status, q: params.q?.trim() || null, programId: params.program || null }),
    listPrograms(ctx),
  ]);
  const canManage = can(ctx, "canManageProperties");
  const properties = canManage
    ? await prisma.property.findMany({ where: propertyScopeWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];

  const href = (next: Partial<{ status: string | null; q: string; program: string }>) => {
    const merged = { status: status ?? undefined, q: params.q, program: params.program, ...next };
    const qs = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => !!e[1]));
    return `/projects${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Projects</h1>
          <p className="text-sm text-muted">{total} projects in scope</p>
        </div>
        {canManage ? <NewProjectForm properties={properties} programs={programs} /> : null}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {[{ key: null, label: "All", count: total }, ...PROJECT_STATUSES.map((s) => ({ key: s, label: TAB_LABELS[s], count: counts[s] }))].map(
          (tab) => (
            <Link
              key={tab.key ?? "all"}
              href={href({ status: tab.key })}
              className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${
                status === tab.key ? "border-brand text-brand" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab.label} <span className="tabular-nums text-xs">({tab.count})</span>
            </Link>
          ),
        )}
      </div>

      <form className="flex flex-wrap gap-2" action="/projects">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search projects or properties"
          className="w-64 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <select name="program" defaultValue={params.program ?? ""} className="rounded-lg border border-border px-3 py-2 text-sm">
          <option value="">All programs</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p._count.projects})
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-zinc-50">
          Filter
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title={total === 0 ? "No projects yet" : "No projects match"}
          description={
            total === 0
              ? "A project is one engagement at one property — a capture, a survey, a renovation — with its team, documents and assessments."
              : "Try another status tab, search or program."
          }
        />
      ) : (
        <ProjectTable projects={items} />
      )}
    </div>
  );
}
