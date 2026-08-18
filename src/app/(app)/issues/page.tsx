import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, issueScopeWhere, can } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; status?: string; search?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const params = await searchParams;

  const issues = await prisma.issue.findMany({
    where: {
      AND: [
        issueScopeWhere(ctx),
        params.severity ? { severity: params.severity as never } : {},
        params.status ? { status: params.status as never } : {},
        params.search ? { title: { contains: params.search, mode: "insensitive" } } : {},
      ],
    },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    include: { property: { select: { id: true, name: true } }, assignee: { select: { name: true } } },
    take: 200,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Issues</h1>
          <p className="text-sm text-muted">{issues.length} issues in scope</p>
        </div>
        {can(ctx, "canCreateIssues") ? (
          <Link href="/issues/new">
            <Button>+ Create Issue</Button>
          </Link>
        ) : null}
      </div>

      <form className="flex flex-wrap gap-2" action="/issues">
        <input name="search" defaultValue={params.search} placeholder="Search title..." className="w-64 rounded-lg border border-border px-3 py-1.5 text-sm outline-none focus:border-brand" />
        <select name="severity" defaultValue={params.severity ?? ""} className="rounded-lg border border-border px-3 py-1.5 text-sm">
          <option value="">Any severity</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        <select name="status" defaultValue={params.status ?? ""} className="rounded-lg border border-border px-3 py-1.5 text-sm">
          <option value="">Any status</option>
          <option value="OPEN">Open</option>
          <option value="TRIAGED">Triaged</option>
          <option value="ASSIGNED">Assigned</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="RESOLVED">Resolved</option>
          <option value="VERIFIED">Verified</option>
          <option value="CLOSED">Closed</option>
        </select>
        <button type="submit" className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">
          Filter
        </button>
      </form>

      {issues.length === 0 ? (
        <EmptyState title="No issues match" description="Great news if this is unfiltered — or try clearing filters." />
      ) : (
        <div className="space-y-2">
          {issues.map((issue) => (
            <Card key={issue.id}>
              <CardBody className="flex items-center justify-between">
                <div>
                  <Link href={`/issues/${issue.id}`} className="font-medium text-foreground hover:text-brand">
                    {issue.title}
                  </Link>
                  <p className="text-xs text-muted">
                    <Link href={`/properties/${issue.property.id}`} className="hover:text-brand">
                      {issue.property.name}
                    </Link>
                    {issue.assignee ? ` · Assigned: ${issue.assignee.name}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={issue.status} />
                  <SeverityBadge severity={issue.severity} />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
