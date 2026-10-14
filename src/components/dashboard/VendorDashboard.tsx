import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatTile } from "@/components/ui/StatTile";
import { getVendorWork } from "@/lib/dashboard-views";

/** Vendor dashboard (spec §17): assigned work only — no portfolio, no finances. */
export function VendorDashboard({ data, vendorName }: { data: Awaited<ReturnType<typeof getVendorWork>>; vendorName: string }) {
  const { captureJobs, sitesOutstanding, sitesReturned, issues, dueThisWeek } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{vendorName}</h1>
        <p className="text-sm text-muted">Assigned work only</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Capture jobs" value={captureJobs.length} href="/capture-jobs" />
        <StatTile label="Sites to deliver" value={sitesOutstanding} href="/capture-jobs" />
        {/* Returned work is surfaced as its own number rather than buried in
            the list. A rejected site is the one thing on this page that is
            already late. */}
        <StatTile
          label="Returned"
          value={sitesReturned}
          href="/capture-jobs"
          tone={sitesReturned > 0 ? "critical" : "default"}
        />
        <StatTile label="Issues due this week" value={dueThisWeek} tone={dueThisWeek > 0 ? "warning" : "default"} />
      </div>

      <Card>
        <CardHeader title="Capture jobs" subtitle="Soonest due first" />
        <CardBody className="p-0">
          {captureJobs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No capture work assigned"
                description="Jobs sent to your company will appear here with the sites and positions to shoot."
              />
            </div>
          ) : (
            <ul>
              {captureJobs.map((job) => (
                <li key={job.id} className="border-b border-border px-5 py-4 last:border-0">
                  <Link href={`/capture-jobs/${job.id}`} className="text-sm font-medium text-foreground hover:text-brand">
                    {job.title}
                  </Link>
                  <ul className="mt-2 space-y-1">
                    {job.sites.map((site) => (
                      <li key={site.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-foreground">{site.propertyName}</span>
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
        <CardHeader title="Assigned Issues" />
        <CardBody className="p-0">
          {issues.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No work assigned yet" description="Issues assigned to your company will appear here." />
            </div>
          ) : (
            <ul>
              {issues.map((issue) => (
                <li key={issue.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
                  <div>
                    <Link href={`/issues/${issue.id}`} className="font-medium text-foreground hover:text-brand">
                      {issue.title}
                    </Link>
                    <p className="text-xs text-muted">
                      {issue.property.name}
                      {issue.asset ? ` · ${issue.asset.name}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={issue.status} />
                    <SeverityBadge severity={issue.severity} />
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
