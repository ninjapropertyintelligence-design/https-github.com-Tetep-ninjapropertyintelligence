import Link from "next/link";
import { PortfolioDashboard } from "@/lib/dashboard";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { HealthBandBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCents, formatRelativeTime, eventLabel } from "@/lib/format";
import { AskAiInline } from "@/components/ai/AskAiInline";

const BAND_ORDER = ["Excellent", "Good", "Needs Attention", "Poor", "Critical"] as const;

/**
 * Shared by Owner, Portfolio Admin, Regional Manager and Viewer dashboards —
 * the underlying `getPortfolioDashboard` call is already scoped per role
 * (org-wide vs region-limited), so one component renders correct numbers
 * for all four; only the surrounding page decides the heading and whether
 * action buttons show.
 */
export function PortfolioOverview({
  data,
  heading,
  subheading,
  showAI,
}: {
  data: PortfolioDashboard;
  heading: string;
  subheading?: string;
  showAI: boolean;
}) {
  if (data.totalProperties === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{heading}</h1>
          {subheading ? <p className="text-sm text-muted">{subheading}</p> : null}
        </div>
        <EmptyState
          title="No properties in scope yet"
          description="Once properties are added to your portfolio (or a region/portfolio is assigned to your account), portfolio health, risk, and capital exposure will appear here."
          action={
            <Link href="/properties" className="text-sm font-medium text-brand">
              Go to Properties →
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{heading}</h1>
        {subheading ? <p className="text-sm text-muted">{subheading}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Total Properties" value={data.totalProperties} href="/properties" />
        <StatTile
          label="Portfolio Health"
          value={data.portfolioHealthScore || "—"}
          tone={data.portfolioHealthScore >= 80 ? "good" : data.portfolioHealthScore >= 65 ? "default" : "critical"}
        />
        <StatTile label="Portfolio Risk" value={data.portfolioRiskScore || "—"} tone={data.portfolioRiskScore >= 60 ? "critical" : "default"} />
        <StatTile
          label="Capital Exposure (12mo)"
          value={formatCents(data.capitalExposure.next12mo)}
          href="/reports?type=capital-exposure"
        />
        <StatTile label="Critical Assets" value={data.criticalAssets} href="/assets?criticality=4" tone={data.criticalAssets > 0 ? "warning" : "default"} />
        <StatTile label="Open Issues" value={data.openIssues} href="/issues?status=OPEN" />
        <StatTile label="Critical Issues" value={data.criticalIssues} href="/issues?severity=CRITICAL" tone={data.criticalIssues > 0 ? "critical" : "default"} />
        <StatTile
          label="Assessments Overdue"
          value={data.assessmentsOverdue}
          href="/assessments?status=overdue"
          tone={data.assessmentsOverdue > 0 ? "warning" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Property Condition Distribution" subtitle="Click a band to see those properties" />
          <CardBody>
            <div className="flex flex-wrap gap-3">
              {BAND_ORDER.map((band) => (
                <Link
                  key={band}
                  href={`/properties?healthBand=${encodeURIComponent(band)}`}
                  className="flex min-w-[90px] flex-1 flex-col items-center rounded-lg border border-border px-3 py-3 hover:border-brand/40"
                >
                  <span className="text-2xl font-semibold tabular-nums">{data.bandCounts[band] ?? 0}</span>
                  <HealthBandBadge band={band} />
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Capital Exposure" subtitle="Estimated by time horizon" />
          <CardBody className="space-y-3">
            <ExposureRow label="Next 12 Months" cents={data.capitalExposure.next12mo} />
            <ExposureRow label="Next 24 Months" cents={data.capitalExposure.next24mo} />
            <ExposureRow label="Next 36 Months" cents={data.capitalExposure.next36mo} />
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Highest Priority Properties" subtitle="Lowest health score first" />
          <CardBody className="p-0">
            {data.highestPriorityProperties.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No health data yet" description="Scores appear once assets have condition data or assessments are completed." />
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {data.highestPriorityProperties.map((p) => (
                    <tr key={p.propertyId} className="border-b border-border last:border-0">
                      <td className="px-5 py-2.5">
                        <Link href={`/properties/${p.propertyId}`} className="font-medium text-foreground hover:text-brand">
                          {p.name}
                        </Link>
                        <p className="text-xs text-muted">
                          {p.city}, {p.state}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.healthScore}</td>
                      <td className="px-3 py-2.5">
                        <HealthBandBadge band={p.band} />
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{formatCents(p.capitalExposure12mo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent Activity" subtitle="Live from the event feed" />
          <CardBody className="p-0">
            {data.recentActivity.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No activity yet" description="Property updates, condition changes, and issue events will appear here as they happen." />
              </div>
            ) : (
              <ul>
                {data.recentActivity.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 border-b border-border px-5 py-2.5 text-sm last:border-0">
                    <div>
                      <p className="text-foreground">{eventLabel(e.type)}</p>
                      <p className="text-xs text-muted">
                        {e.propertyName ? (
                          <Link href={`/properties/${e.propertyId}`} className="hover:text-brand">
                            {e.propertyName}
                          </Link>
                        ) : null}
                        {e.actorName ? ` · ${e.actorName}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted">{formatRelativeTime(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {showAI ? <AskAiInline placeholder="Which are my worst properties?" /> : null}
    </div>
  );
}

function ExposureRow({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{formatCents(cents)}</span>
    </div>
  );
}
