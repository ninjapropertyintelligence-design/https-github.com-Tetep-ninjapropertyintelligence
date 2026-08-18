import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/format";
import { getMyFieldWork } from "@/lib/dashboard-views";

/** Inspector / Technician "what do I need to do today" home (spec §8, §11). */
export function FieldWorkDashboard({
  data,
  isInspector,
}: {
  data: Awaited<ReturnType<typeof getMyFieldWork>>;
  isInspector: boolean;
}) {
  const { myAssessments, myIssues, propertyCount } = data;
  const dueToday = myAssessments.filter((a) => a.scheduledFor && new Date(a.scheduledFor).toDateString() === new Date().toDateString());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Today&apos;s Work</h1>
        <p className="text-sm text-muted">
          {myAssessments.length} assigned assessment{myAssessments.length === 1 ? "" : "s"} · {myIssues.length} open issue
          {myIssues.length === 1 ? "" : "s"} · {propertyCount} propert{propertyCount === 1 ? "y" : "ies"}
        </p>
      </div>

      {myAssessments.length === 0 && myIssues.length === 0 ? (
        <EmptyState title="Nothing assigned right now" description="Assigned assessments and issues will show up here." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={isInspector ? "My Assignments" : "My Assessments"} subtitle={dueToday.length > 0 ? `${dueToday.length} due today` : undefined} />
            <CardBody className="p-0">
              {myAssessments.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No assessments assigned" />
                </div>
              ) : (
                <ul>
                  {myAssessments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
                      <div>
                        <Link href={`/assessments/${a.id}`} className="font-medium text-foreground hover:text-brand">
                          {a.template.name}
                        </Link>
                        <p className="text-xs text-muted">
                          {a.property.name} · {a.property.city}, {a.property.state}
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={a.status} />
                        <p className="mt-1 text-xs text-muted">Due {formatDate(a.scheduledFor)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="My Issues" />
            <CardBody className="p-0">
              {myIssues.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No issues assigned" />
                </div>
              ) : (
                <ul>
                  {myIssues.map((i) => (
                    <li key={i.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
                      <div>
                        <Link href={`/issues/${i.id}`} className="font-medium text-foreground hover:text-brand">
                          {i.title}
                        </Link>
                        <p className="text-xs text-muted">{i.property.name}</p>
                      </div>
                      <SeverityBadge severity={i.severity} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
