import { redirect } from "next/navigation";
import { can, getSessionContext } from "@/lib/session-context";
import {
  summarizeActiveUsers,
  summarizeFeatureAdoption,
  summarizeRetention,
} from "@/lib/analytics";
import { UsageAnalytics } from "@/components/reports/UsageAnalytics";

/**
 * Product analytics (spec §105) for the viewer's own organization.
 *
 * Gated on canViewAuditLogs: this describes what the organization's own
 * people did, so it belongs with the audit trail rather than being broadly
 * readable.
 */
export default async function UsagePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.organizationId || !can(ctx, "canViewAuditLogs")) redirect("/dashboard");

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [adoption, activeUsers, retention] = await Promise.all([
    summarizeFeatureAdoption(ctx.organizationId, periodStart, periodEnd),
    summarizeActiveUsers(ctx.organizationId, periodEnd),
    summarizeRetention(ctx.organizationId, 8, periodEnd),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Product Usage</h1>
        <p className="text-sm text-muted">{ctx.organizationName} · last 30 days</p>
      </div>
      <div className="max-w-4xl">
        <UsageAnalytics
          data={{
            adoption: {
              ...adoption,
              window: {
                requestedFrom: adoption.window.requestedFrom.toISOString(),
                requestedTo: adoption.window.requestedTo.toISOString(),
                trackingStartedAt: adoption.window.trackingStartedAt?.toISOString() ?? null,
                partialWindow: adoption.window.partialWindow,
              },
            },
            activeUsers: {
              daily: activeUsers.daily,
              weekly: activeUsers.weekly,
              monthly: activeUsers.monthly,
              stickiness: activeUsers.stickiness,
            },
            retention: retention.map((c) => ({
              cohortWeekStart: c.cohortWeekStart.toISOString(),
              cohortSize: c.cohortSize,
              weeks: c.weeks,
            })),
          }}
        />
      </div>
    </div>
  );
}
