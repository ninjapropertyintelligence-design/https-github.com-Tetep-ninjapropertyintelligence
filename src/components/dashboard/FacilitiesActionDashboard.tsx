import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { SeverityBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/format";
import { AskAiInline } from "@/components/ai/AskAiInline";
import { getFacilitiesActionQueue } from "@/lib/dashboard-views";

export function FacilitiesActionDashboard({
  data,
  showAI,
}: {
  data: Awaited<ReturnType<typeof getFacilitiesActionQueue>>;
  showAI: boolean;
}) {
  const { criticalIssues, highIssues, overdueAssessments, deterioratedAssets } = data;
  const totalActionItems = criticalIssues.length + highIssues.length + overdueAssessments.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">What needs action</h1>
        <p className="text-sm text-muted">
          {totalActionItems === 0 ? "Nothing urgent right now." : `${totalActionItems} item${totalActionItems === 1 ? "" : "s"} need your attention.`}
        </p>
      </div>

      {totalActionItems === 0 && deterioratedAssets.length === 0 ? (
        <EmptyState title="All clear" description="No critical/high issues, no overdue assessments. Nice work." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Priority Issues" subtitle="Critical, then high severity" />
            <CardBody className="p-0">
              {criticalIssues.length === 0 && highIssues.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No priority issues" />
                </div>
              ) : (
                <ul>
                  {[...criticalIssues, ...highIssues].map((issue) => (
                    <li key={issue.id} className="flex items-start justify-between gap-3 border-b border-border px-5 py-3 text-sm last:border-0">
                      <div>
                        <Link href={`/issues/${issue.id}`} className="font-medium text-foreground hover:text-brand">
                          {issue.title}
                        </Link>
                        <p className="text-xs text-muted">
                          {issue.property.name}
                          {issue.asset ? ` · ${issue.asset.name}` : ""}
                          {issue.estimatedCost ? ` · est. $${(issue.estimatedCost / 100).toLocaleString()}` : ""}
                        </p>
                      </div>
                      <SeverityBadge severity={issue.severity} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Overdue Inspections" />
            <CardBody className="p-0">
              {overdueAssessments.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No overdue inspections" />
                </div>
              ) : (
                <ul>
                  {overdueAssessments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
                      <Link href={`/properties/${a.property.id}`} className="font-medium text-foreground hover:text-brand">
                        {a.property.name}
                      </Link>
                      <span className="text-xs text-muted">Due {formatDate(a.scheduledFor)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Recently Deteriorated Assets" subtitle="Condition changes into Poor/Critical" />
            <CardBody className="p-0">
              {deterioratedAssets.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No recent deterioration" />
                </div>
              ) : (
                <ul>
                  {deterioratedAssets.map((h) => (
                    <li key={h.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
                      <div>
                        <Link href={`/assets/${h.asset.id}`} className="font-medium text-foreground hover:text-brand">
                          {h.asset.name}
                        </Link>
                        <p className="text-xs text-muted">{h.asset.property.name}</p>
                      </div>
                      <span className="tabular-nums text-sm text-[var(--band-critical)]">
                        {h.previousScore ?? "—"} → {h.newScore}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {showAI ? <AskAiInline placeholder="What needs my attention today?" /> : null}
    </div>
  );
}
