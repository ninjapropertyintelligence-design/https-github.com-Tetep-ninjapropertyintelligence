import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCents, formatDate } from "@/lib/format";
import { healthBandFor } from "@/lib/scoring-categories";
import { CategoryBreakdownEntry } from "@/lib/scoring";
import { ScoringCategory } from "@/lib/scoring-categories";

export function OverviewTab({
  property,
  health,
  counts,
  lastAssessment,
  lastInteriorCapture,
  lastExteriorCapture,
}: {
  property: { id: string; name: string; customerPropertyId: string | null; addressLine1: string; city: string; state: string; squareFootage: number | null; yearBuilt: number | null };
  health: {
    healthScore: number;
    riskScore: number;
    dataConfidenceScore: number;
    interiorScore: number | null;
    exteriorScore: number | null;
    capitalExposure12mo: number;
    categoryBreakdown: Record<ScoringCategory, CategoryBreakdownEntry>;
  } | null;
  counts: { openIssues: number; criticalIssues: number; assetCount: number; criticalAssetCount: number };
  lastAssessment: Date | null;
  lastInteriorCapture: Date | null;
  lastExteriorCapture: Date | null;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          label="Health Score"
          value={health?.healthScore ?? "—"}
          tone={!health ? "default" : health.healthScore >= 80 ? "good" : health.healthScore >= 65 ? "default" : "critical"}
          sublabel={health ? healthBandFor(health.healthScore) : "No data yet"}
        />
        <StatTile label="Risk Score" value={health?.riskScore ?? "—"} tone={health && health.riskScore >= 60 ? "critical" : "default"} />
        <StatTile label="Data Confidence" value={health ? `${Math.round(health.dataConfidenceScore)}%` : "—"} />
        <StatTile label="CapEx (12mo)" value={health ? formatCents(health.capitalExposure12mo) : "—"} href="#reports" />
        <StatTile label="Open Issues" value={counts.openIssues} tone={counts.openIssues > 0 ? "warning" : "default"} />
        <StatTile label="Critical Issues" value={counts.criticalIssues} tone={counts.criticalIssues > 0 ? "critical" : "default"} />
        <StatTile label="Assets" value={counts.assetCount} />
        <StatTile label="Critical Assets" value={counts.criticalAssetCount} tone={counts.criticalAssetCount > 0 ? "warning" : "default"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Category Health Breakdown" subtitle="Weighted contribution to the property health score" />
          <CardBody>
            {!health ? (
              <EmptyState title="No score computed yet" description="Scores appear once assets have condition data or an assessment is completed." />
            ) : (
              <div className="space-y-2">
                {Object.entries(health.categoryBreakdown).map(([category, entry]) => (
                  <div key={category} className="flex items-center gap-3">
                    <span className="w-36 shrink-0 text-sm text-muted">{category.replace(/([A-Z])/g, " $1").trim()}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${entry.score !== null ? entry.score : 0}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-xs tabular-nums text-muted">{entry.score !== null ? Math.round(entry.score) : "—"}</span>
                    <span className="w-10 text-right text-xs tabular-nums text-muted">{Math.round(entry.weightPercent)}%</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Property Details" />
          <CardBody className="space-y-2 text-sm">
            <DetailRow label="Property ID" value={property.customerPropertyId ?? "—"} />
            <DetailRow label="Address" value={`${property.addressLine1}, ${property.city}, ${property.state}`} />
            <DetailRow label="Square Footage" value={property.squareFootage ? property.squareFootage.toLocaleString() : "—"} />
            <DetailRow label="Year Built" value={property.yearBuilt ?? "—"} />
            <DetailRow label="Last Assessment" value={formatDate(lastAssessment)} />
            <DetailRow label="Last Interior Capture" value={formatDate(lastInteriorCapture)} />
            <DetailRow label="Last Exterior Capture" value={formatDate(lastExteriorCapture)} />
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
