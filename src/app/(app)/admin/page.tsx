import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { formatRelativeTime } from "@/lib/format";

/**
 * Platform Administration (spec §20-21). Answers: "Is the entire system
 * healthy and are customers operating normally?" Cross-org visibility —
 * gated on `isPlatformAdmin`, not any organization-scoped permission.
 */
export default async function AdminPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.isPlatformAdmin) redirect("/dashboard");

  const [orgCount, userCount, propertyCount, activeUploadFailures, failedProcessingJobs, recentAuditLogs, orgs] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.property.count(),
    prisma.droneCapture.count({ where: { status: "FAILED" } }),
    prisma.droneProcessingJob.count({ where: { status: "FAILED" } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { actor: { select: { name: true } }, organization: { select: { name: true } } } }),
    prisma.organization.findMany({
      include: { _count: { select: { properties: true, memberships: true } }, subscription: { include: { plan: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Platform Administration</h1>
        <p className="text-sm text-muted">Is the system healthy and are customers operating normally?</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatTile label="Organizations" value={orgCount} />
        <StatTile label="Active Users" value={userCount} />
        <StatTile label="Properties" value={propertyCount} />
        <StatTile label="Failed Captures" value={activeUploadFailures} tone={activeUploadFailures > 0 ? "critical" : "default"} />
        <StatTile label="Failed Processing Jobs" value={failedProcessingJobs} tone={failedProcessingJobs > 0 ? "critical" : "default"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Organizations" />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Organization</th>
                  <th className="px-3 py-2.5 font-medium">Plan</th>
                  <th className="px-3 py-2.5 font-medium">Properties</th>
                  <th className="px-5 py-2.5 font-medium">Users</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5 font-medium text-foreground">{o.name}</td>
                    <td className="px-3 py-2.5 text-muted">{o.subscription?.plan.name ?? "—"}</td>
                    <td className="px-3 py-2.5 tabular-nums">{o._count.properties}</td>
                    <td className="px-5 py-2.5 tabular-nums">{o._count.memberships}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent Audit Log" subtitle="Across all organizations" />
          <CardBody className="p-0">
            <ul>
              {recentAuditLogs.map((log) => (
                <li key={log.id} className="flex items-center justify-between border-b border-border px-5 py-2.5 text-sm last:border-0">
                  <div>
                    <p className="text-foreground">{log.action}</p>
                    <p className="text-xs text-muted">
                      {log.organization?.name ?? "—"} · {log.actor?.name ?? "system"}
                    </p>
                  </div>
                  <span className="text-xs text-muted">{formatRelativeTime(log.createdAt)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
