import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatTile } from "@/components/ui/StatTile";
import { getVendorWork } from "@/lib/dashboard-views";

/** Vendor dashboard (spec §17): assigned work only — no portfolio, no finances. */
export function VendorDashboard({ data, vendorName }: { data: Awaited<ReturnType<typeof getVendorWork>>; vendorName: string }) {
  const { issues, propertyCount, dueThisWeek } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{vendorName}</h1>
        <p className="text-sm text-muted">Assigned work only</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Assigned Properties" value={propertyCount} />
        <StatTile label="Open Jobs" value={issues.length} />
        <StatTile label="Due This Week" value={dueThisWeek} tone={dueThisWeek > 0 ? "warning" : "default"} />
      </div>

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
