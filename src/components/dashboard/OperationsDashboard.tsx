import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatTile } from "@/components/ui/StatTile";
import type { getOperationsDashboard } from "@/lib/ops-dashboard";

/**
 * The internal operations screen: what is running, who is on it, where they
 * were last, and what is waiting on me.
 *
 * Deliberately one page rather than four. The previous six staff dashboards
 * each answered a slice, which meant nobody could answer "is the Midwest
 * sweep going to land on time" without opening three of them.
 */

/** "14m ago". Coarse on purpose — a dispatcher needs recency, not precision. */
function ago(at: Date | string | null): string | null {
  if (!at) return null;
  const minutes = Math.floor((Date.now() - new Date(at).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function DueLabel({ days }: { days: number | null }) {
  if (days === null) return <span className="text-xs text-muted">No due date</span>;
  if (days < 0) {
    return (
      <span className="text-xs font-medium text-[var(--band-critical)]">
        {Math.abs(days)}d overdue
      </span>
    );
  }
  if (days <= 3) {
    return <span className="text-xs font-medium text-[var(--band-needs-attention)]">Due in {days}d</span>;
  }
  return <span className="text-xs text-muted">Due in {days}d</span>;
}

export function OperationsDashboard({
  data,
  canReview,
}: {
  data: Awaited<ReturnType<typeof getOperationsDashboard>>;
  /** Whether this viewer may accept or reject — hides the queue's framing if not. */
  canReview: boolean;
}) {
  const { counts, openJobs, draftJobs, crews, awaitingReview, mine, attention } = data;
  const myWorkCount = mine.assessments.length + mine.issues.length;
  const attentionCount = attention.criticalIssues + attention.highIssues + attention.overdueAssessments;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Operations</h1>
        <p className="text-sm text-muted">Capture work in flight, and who is on it</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatTile label="Jobs running" value={counts.openJobs} href="/capture-jobs" />
        <StatTile
          label="Awaiting review"
          value={counts.awaitingReview}
          href="/capture-jobs"
          tone={counts.awaitingReview > 0 ? "warning" : "default"}
        />
        <StatTile
          label="Overdue"
          value={counts.overdueJobs}
          href="/capture-jobs"
          tone={counts.overdueJobs > 0 ? "critical" : "default"}
        />
        <StatTile
          label="Crews out"
          value={counts.activeCrews}
          sublabel={`of ${counts.totalCrews} on the roster`}
        />
        <StatTile label="Drafts" value={counts.draftJobs} href="/capture-jobs" sublabel="Not yet issued" />
      </div>

      {/* Carried over from the facilities action queue this page replaced.
          Counts only, linking into the filtered lists — the full triage
          belongs on /issues, not on a dashboard. */}
      {attentionCount > 0 ? (
        <Card>
          <CardHeader title="Needs attention" subtitle="Across the sites you can see" />
          <CardBody className="flex flex-wrap gap-6 text-sm">
            {attention.criticalIssues > 0 ? (
              <Link href="/issues?severity=CRITICAL" className="hover:underline">
                <span className="font-semibold tabular-nums text-[var(--band-critical)]">
                  {attention.criticalIssues}
                </span>{" "}
                <span className="text-muted">critical {attention.criticalIssues === 1 ? "issue" : "issues"}</span>
              </Link>
            ) : null}
            {attention.highIssues > 0 ? (
              <Link href="/issues?severity=HIGH" className="hover:underline">
                <span className="font-semibold tabular-nums text-[var(--band-needs-attention)]">
                  {attention.highIssues}
                </span>{" "}
                <span className="text-muted">high {attention.highIssues === 1 ? "issue" : "issues"}</span>
              </Link>
            ) : null}
            {attention.overdueAssessments > 0 ? (
              <Link href="/assessments" className="hover:underline">
                <span className="font-semibold tabular-nums text-[var(--band-needs-attention)]">
                  {attention.overdueAssessments}
                </span>{" "}
                <span className="text-muted">overdue {attention.overdueAssessments === 1 ? "assessment" : "assessments"}</span>
              </Link>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/* An Inspector's or Technician's own work. Rendered only when they
          have some, so it does not show an empty card to a Portfolio Admin
          who is never assigned anything directly. */}
      {myWorkCount > 0 ? (
        <Card>
          <CardHeader title="Your assignments" />
          <CardBody className="p-0">
            <ul>
              {mine.assessments.map((assessment) => (
                <li
                  key={assessment.id}
                  className="flex items-center justify-between gap-4 border-b border-border px-5 py-3 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/assessments/${assessment.id}`}
                      className="font-medium text-foreground hover:text-brand"
                    >
                      {assessment.template?.name ?? "Assessment"}
                    </Link>
                    <p className="truncate text-xs text-muted">{assessment.property.name}</p>
                  </div>
                  <StatusBadge status={assessment.status} />
                </li>
              ))}
              {mine.issues.map((issue) => (
                <li
                  key={issue.id}
                  className="flex items-center justify-between gap-4 border-b border-border px-5 py-3 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <Link href={`/issues/${issue.id}`} className="font-medium text-foreground hover:text-brand">
                      {issue.title}
                    </Link>
                    <p className="truncate text-xs text-muted">{issue.property.name}</p>
                  </div>
                  <SeverityBadge severity={issue.severity} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {/* The queue comes before the job list: it is the only part of this page
          that is a to-do rather than a status. */}
      <Card>
        <CardHeader
          title={canReview ? "Waiting on you" : "Submitted, awaiting review"}
          subtitle={canReview ? "Oldest submission first" : undefined}
        />
        <CardBody className="p-0">
          {awaitingReview.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nothing waiting"
                description="Sites a subcontractor has submitted will queue here for acceptance."
              />
            </div>
          ) : (
            <ul>
              {awaitingReview.map((row) => (
                <li
                  key={row.siteId}
                  className="flex items-center justify-between gap-4 border-b border-border px-5 py-3 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <Link href={`/capture-jobs/${row.jobId}`} className="font-medium text-foreground hover:text-brand">
                      {row.propertyName}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {row.jobTitle}
                      {row.vendorName ? ` · ${row.vendorName}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted">
                    {ago(row.submittedAt) ? `submitted ${ago(row.submittedAt)}` : "submitted"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Jobs in flight" subtitle="Soonest due first" />
        <CardBody className="p-0">
          {openJobs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No jobs running"
                description={
                  draftJobs.length > 0
                    ? `${draftJobs.length} draft ${draftJobs.length === 1 ? "job is" : "jobs are"} waiting to be issued.`
                    : "Create a capture job to send a subcontractor to site."
                }
              />
            </div>
          ) : (
            <ul>
              {openJobs.map((job) => (
                <li key={job.id} className="border-b border-border px-5 py-4 last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/capture-jobs/${job.id}`} className="font-medium text-foreground hover:text-brand">
                        {job.title}
                      </Link>
                      <p className="text-xs text-muted">
                        {job.vendorName ?? "Unassigned"} · {job.sitesAccepted} of {job.sitesTotal} sites accepted
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <DueLabel days={job.daysUntilDue} />
                      <StatusBadge status={job.status} />
                    </div>
                  </div>

                  {/* Per-site line. This is the "where is he and what is he
                      doing" answer: which stop, what state, how far through
                      the route. */}
                  <ul className="mt-2.5 space-y-1">
                    {job.sites.map((site) => (
                      <li key={site.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <Link
                          href={`/properties/${site.propertyId}`}
                          className="font-medium text-foreground hover:text-brand"
                        >
                          {site.propertyName}
                        </Link>
                        <StatusBadge status={site.status} />
                        {site.shotsTotal > 0 ? (
                          <span className="text-muted tabular-nums">
                            route {site.shotsCaptured}/{site.shotsTotal}
                          </span>
                        ) : null}
                        {site.rejectionReason ? (
                          <span className="text-[var(--band-critical)]">returned: {site.rejectionReason}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Subcontractors"
          subtitle="Who is out, and who is free to take the next job"
          action={
            <Link href="/capture-jobs" className="text-xs font-medium text-brand hover:underline">
              Assign work
            </Link>
          }
        />
        <CardBody className="p-0">
          {crews.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No subcontractors yet"
                description="Add a vendor company before issuing capture work."
              />
            </div>
          ) : (
            <ul>
              {crews.map((crew) => (
                <li
                  key={crew.vendorId}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{crew.vendorName}</p>
                    <p className="truncate text-xs text-muted">
                      {crew.trade ?? "—"}
                      {crew.contactEmail ? ` · ${crew.contactEmail}` : ""}
                      {crew.contactPhone ? ` · ${crew.contactPhone}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {crew.openJobCount === 0 ? (
                      <span className="text-xs font-medium text-[var(--band-good)]">Available</span>
                    ) : (
                      <>
                        <p className="text-xs text-foreground tabular-nums">
                          {crew.openJobCount} {crew.openJobCount === 1 ? "job" : "jobs"} · {crew.siteCount}{" "}
                          {crew.siteCount === 1 ? "site" : "sites"}
                        </p>
                        {/* Worded as "last uploaded", never "is at". There is no
                            GPS and no check-in behind this number — it is the
                            newest file on one of their live sites. */}
                        <p className="text-xs text-muted">
                          {crew.lastUploadAt
                            ? `last uploaded to ${crew.lastUploadPropertyName} ${ago(crew.lastUploadAt)}`
                            : "no uploads yet"}
                        </p>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
