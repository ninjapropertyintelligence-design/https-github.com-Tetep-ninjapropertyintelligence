import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { EmptyState } from "@/components/ui/EmptyState";
import { TemplateActiveToggle } from "@/components/assessment/TemplateActiveToggle";
import { listTemplatesForManagers } from "@/lib/template-service";
import { formatDate } from "@/lib/format";

export default async function TemplatesPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canManageAssessmentTemplates")) redirect("/assessments");
  const templates = await listTemplatesForManagers(ctx);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/assessments" className="text-xs text-muted hover:text-brand">
            ← Assessments
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-foreground">Assessment templates</h1>
          <p className="text-sm text-muted">The surveys inspectors fill in: sections of tasks of questions.</p>
        </div>
        <Link href="/assessments/templates/new" className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90">
          New template
        </Link>
      </div>

      {templates.length === 0 ? (
        <EmptyState title="No templates yet" description="Create a template to start scheduling assessments." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Template</th>
                <th className="px-5 py-2.5 font-medium">Contents</th>
                <th className="px-5 py-2.5 font-medium">Used by</th>
                <th className="px-5 py-2.5 font-medium">Updated</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3">
                    <Link href={`/assessments/templates/${t.id}`} className="font-medium text-foreground hover:text-brand">
                      {t.name}
                    </Link>
                    {!t.isActive ? <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-muted">Retired</span> : null}
                    {t.description ? <p className="text-xs text-muted">{t.description}</p> : null}
                  </td>
                  <td className="px-5 py-3 text-muted">
                    {t.sections} sections · {t.tasks} tasks · {t.questions} questions
                  </td>
                  <td className="px-5 py-3 text-muted">
                    {t.usedBy} assessment{t.usedBy === 1 ? "" : "s"}
                  </td>
                  <td className="px-5 py-3 text-muted">{formatDate(t.updatedAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <span className="inline-flex items-center gap-1">
                      {t.usedBy > 0 ? (
                        <a href={`/api/v1/assessments/templates/${t.id}/export`} className="rounded-lg px-3 py-2 text-sm text-foreground hover:bg-zinc-100">
                          Export answers
                        </a>
                      ) : null}
                      <TemplateActiveToggle templateId={t.id} isActive={t.isActive} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
