"use client";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";

export interface AnalyticsWindowView {
  requestedFrom: string;
  requestedTo: string;
  trackingStartedAt: string | null;
  partialWindow: boolean;
}

export interface UsageAnalyticsView {
  adoption: {
    window: AnalyticsWindowView;
    eligibleUsers: number;
    features: Array<{ feature: string; users: number; events: number }>;
    unusedFeatures: string[];
    excludedImpersonatedEvents: number;
  };
  activeUsers: {
    daily: number;
    weekly: number;
    monthly: number;
    stickiness: number | null;
  };
  retention: Array<{
    cohortWeekStart: string;
    cohortSize: number;
    weeks: Array<number | null>;
  }>;
}

const FEATURE_LABEL: Record<string, string> = {
  "dashboard.viewed": "Dashboard",
  "portfolio.viewed": "Property list",
  "property.viewed": "Property detail",
  "map.viewed": "Portfolio map",
  "asset.viewed": "Asset detail",
  "issue.created": "Issue created",
  "issue.resolved": "Issue resolved",
  "assessment.started": "Assessment started",
  "assessment.completed": "Assessment completed",
  "document.uploaded": "Document uploaded",
  "document.searched": "Document search",
  "ai.question_asked": "AI question",
  "report.generated": "Report generated",
  "report.exported": "Report exported",
  "import.wizard_started": "Import wizard opened",
  "import.wizard_completed": "Import completed",
  "import.wizard_abandoned": "Import abandoned",
  "drone.capture_created": "Drone capture",
  "interior.tour_viewed": "Interior tour",
  "cogs.viewed": "Cost to serve",
  "storage_settings.viewed": "Storage settings",
  "retention_settings.viewed": "Retention settings",
  "webhook.configured": "Webhook configured",
  "mfa.enrolled": "MFA enrolled",
};

function label(feature: string): string {
  return FEATURE_LABEL[feature] ?? feature;
}

/**
 * Product analytics for one organization (spec §105).
 *
 * The notices are load-bearing, not decoration. A dashboard that shows "0
 * users" for a feature is indistinguishable from one that was not measuring
 * yet, and someone will make a roadmap decision on the difference — so an
 * incomplete window says so, and support impersonation is reported as
 * excluded rather than silently folded in or silently dropped.
 */
export function UsageAnalytics({ data }: { data: UsageAnalyticsView }) {
  const { adoption, activeUsers, retention } = data;
  const tracked = adoption.window.trackingStartedAt;

  return (
    <div className="space-y-4">
      {tracked === null ? (
        <div className="rounded-lg border border-border px-4 py-3 text-sm">
          <p className="font-medium text-foreground">Nothing tracked yet.</p>
          <p className="mt-0.5 text-muted">
            No product usage has been recorded for this organization. The figures below are empty
            because there is no data — not because nobody used anything.
          </p>
        </div>
      ) : adoption.window.partialWindow ? (
        <div className="rounded-lg border border-border px-4 py-3 text-sm">
          <p className="font-medium text-foreground">Partial window.</p>
          <p className="mt-0.5 text-muted">
            Usage tracking began {new Date(tracked).toLocaleDateString()}, which is after the start
            of the period requested. These figures cover less time than the range shown.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Active users" subtitle="Distinct people, excluding platform support sessions." />
        <CardBody className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Daily" value={activeUsers.daily} />
          <Stat label="Weekly" value={activeUsers.weekly} />
          <Stat label="Monthly" value={activeUsers.monthly} />
          <Stat
            label="Stickiness"
            value={
              activeUsers.stickiness === null
                ? "—"
                : `${Math.round(activeUsers.stickiness * 100)}%`
            }
            hint={activeUsers.stickiness === null ? "needs a full month of history" : "daily ÷ monthly"}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Feature adoption"
          subtitle={`Distinct users per feature, out of ${adoption.eligibleUsers} member${
            adoption.eligibleUsers === 1 ? "" : "s"
          }.`}
        />
        <CardBody className="p-0">
          {adoption.features.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">No feature usage recorded in this period.</p>
          ) : (
            <ul data-testid="feature-adoption">
              {adoption.features.map((f) => (
                <li
                  key={f.feature}
                  className="flex items-center justify-between border-b border-border px-5 py-2.5 text-sm last:border-0"
                >
                  <span className="text-foreground">{label(f.feature)}</span>
                  <span className="text-xs text-muted">
                    <span className="font-medium text-foreground">{f.users}</span>
                    {adoption.eligibleUsers > 0 ? ` / ${adoption.eligibleUsers} users` : " users"} ·{" "}
                    {f.events} uses
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Not used at all"
          subtitle="Features nobody touched in this period — usually the most actionable line here."
        />
        <CardBody className="text-sm">
          {adoption.unusedFeatures.length === 0 ? (
            <p className="text-muted">Every tracked feature was used at least once.</p>
          ) : (
            <p className="text-muted" data-testid="unused-features">
              {adoption.unusedFeatures.map(label).join(" · ")}
            </p>
          )}
        </CardBody>
      </Card>

      {adoption.excludedImpersonatedEvents > 0 ? (
        <Card>
          <CardHeader title="Excluded from the figures above" />
          <CardBody className="text-sm text-muted">
            {adoption.excludedImpersonatedEvents} event
            {adoption.excludedImpersonatedEvents === 1 ? "" : "s"} came from a platform support
            session viewing this account. Support activity is not customer engagement, so it is
            reported here rather than counted above.
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Weekly retention"
          subtitle="Of the members who joined each week, how many were still active later. A blank cell is a week that has not finished."
        />
        <CardBody className="p-0">
          {retention.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">
              No members joined within the period, so there is no cohort to follow.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-5 py-2 font-medium">Cohort</th>
                    <th className="px-2 py-2 font-medium">Size</th>
                    {retention[0].weeks.map((_, i) => (
                      <th key={i} className="px-2 py-2 font-medium">
                        W{i}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {retention.map((c) => (
                    <tr key={c.cohortWeekStart} className="border-b border-border last:border-0">
                      <td className="px-5 py-2 text-foreground">
                        {new Date(c.cohortWeekStart).toLocaleDateString()}
                      </td>
                      <td className="px-2 py-2 text-muted">{c.cohortSize}</td>
                      {c.weeks.map((w, i) => (
                        <td key={i} className="px-2 py-2 text-muted">
                          {w === null ? "—" : w}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Stat({
  label: text,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted">{text}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
