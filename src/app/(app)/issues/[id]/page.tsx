import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext, issueScopeWhere, can } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { formatCents, formatDate, formatRelativeTime } from "@/lib/format";
import { IssueStatusForm } from "@/components/issue/IssueStatusForm";
import { CommentForm } from "@/components/issue/CommentForm";

export default async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const { id } = await params;

  const issue = await prisma.issue.findFirst({
    where: { AND: [{ id }, issueScopeWhere(ctx)] },
    include: {
      property: { select: { id: true, name: true } },
      asset: { select: { id: true, name: true } },
      assignee: { select: { name: true } },
      vendor: { select: { name: true } },
      createdBy: { select: { name: true } },
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
      evidence: true,
      documents: true,
    },
  });
  if (!issue) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/properties/${issue.property.id}`} className="text-xs text-muted hover:text-brand">
          ← {issue.property.name}
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{issue.title}</h1>
          <SeverityBadge severity={issue.severity} />
          <StatusBadge status={issue.status} />
        </div>
        {issue.description ? <p className="mt-2 max-w-2xl text-sm text-muted">{issue.description}</p> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Discussion" />
          <CardBody className="space-y-3">
            {issue.comments.length === 0 ? (
              <p className="text-sm text-muted">No comments yet.</p>
            ) : (
              <ul className="space-y-3">
                {issue.comments.map((c) => (
                  <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
                    <p className="text-foreground">{c.body}</p>
                    <p className="mt-1 text-xs text-muted">
                      {c.author.name} · {formatRelativeTime(c.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <CommentForm issueId={issue.id} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody className="space-y-2 text-sm">
            <DetailRow label="Asset" value={issue.asset ? <Link href={`/assets/${issue.asset.id}`} className="text-brand">{issue.asset.name}</Link> : "—"} />
            <DetailRow label="Assignee" value={issue.assignee?.name ?? "Unassigned"} />
            <DetailRow label="Vendor" value={issue.vendor?.name ?? "—"} />
            <DetailRow label="Estimated Cost" value={issue.estimatedCost ? formatCents(issue.estimatedCost) : "—"} />
            <DetailRow label="Actual Cost" value={issue.actualCost ? formatCents(issue.actualCost) : "—"} />
            <DetailRow label="Due Date" value={formatDate(issue.dueDate)} />
            <DetailRow label="Source" value={issue.source.replace(/_/g, " ")} />
            <DetailRow label="Created By" value={issue.createdBy.name} />
            {can(ctx, "canCreateIssues") || can(ctx, "canResolveIssues") ? (
              <div className="pt-2">
                <IssueStatusForm issueId={issue.id} currentStatus={issue.status} version={issue.version} />
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Evidence" />
          <CardBody className="p-0">
            {issue.evidence.length === 0 ? <div className="p-5"><EmptyState title="No evidence attached" /></div> : (
              <ul>
                {issue.evidence.map((e) => (
                  <li key={e.id} className="border-b border-border px-5 py-2.5 text-sm last:border-0">{e.type.replace(/_/g, " ")}</li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Documents" />
          <CardBody className="p-0">
            {issue.documents.length === 0 ? <div className="p-5"><EmptyState title="No documents attached" /></div> : (
              <ul>
                {issue.documents.map((d) => (
                  <li key={d.id} className="border-b border-border px-5 py-2.5 text-sm last:border-0">{d.title}</li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-1.5 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
