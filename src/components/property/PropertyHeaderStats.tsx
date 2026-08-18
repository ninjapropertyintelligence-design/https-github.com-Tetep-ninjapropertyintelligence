import { HealthBandBadge } from "@/components/ui/Badge";
import { formatCents } from "@/lib/format";
import { healthBandFor } from "@/lib/scoring-categories";

/**
 * Shared header shown above every tab on the property page (spec §22):
 * "STORE #1052  Health 71  Risk 76  Confidence 94%  Exposure $185K". Every
 * tab reads the same propertyId, and this same computed snapshot, so the
 * numbers never drift between tabs.
 */
export function PropertyHeaderStats({
  health,
}: {
  health: { healthScore: number; riskScore: number; dataConfidenceScore: number; capitalExposure12mo: number } | null;
}) {
  if (!health) {
    return <p className="text-xs text-muted">No health data calculated yet for this property.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
      <span>
        <span className="text-muted">Health</span> <span className="font-semibold tabular-nums">{health.healthScore}</span>
      </span>
      <span>
        <span className="text-muted">Risk</span> <span className="font-semibold tabular-nums">{health.riskScore}</span>
      </span>
      <span>
        <span className="text-muted">Confidence</span>{" "}
        <span className="font-semibold tabular-nums">{Math.round(health.dataConfidenceScore)}%</span>
      </span>
      <span>
        <span className="text-muted">Exposure</span>{" "}
        <span className="font-semibold tabular-nums">{formatCents(health.capitalExposure12mo)}</span>
      </span>
      <HealthBandBadge band={healthBandFor(health.healthScore)} />
    </div>
  );
}
