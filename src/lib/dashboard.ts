import { prisma } from "@/lib/prisma";
import { SessionContext, propertyScopeWhere } from "@/lib/session-context";
import { getLatestHealthSnapshots } from "@/lib/scoring";
import { healthBandFor } from "@/lib/scoring-categories";

/**
 * ONE SOURCE OF TRUTH for every portfolio-level KPI (spec §35 "One Source of
 * Truth"). The API route, the AI tool gateway's `getPortfolioSummary`, and
 * (later) reports all call this exact function — none of them recompute
 * these numbers independently. Scoping via `propertyScopeWhere` means an
 * Owner gets org-wide numbers and a Regional Manager gets region-limited
 * numbers from the identical code path.
 */
export async function getPortfolioDashboard(ctx: SessionContext) {
  const scopedWhere = propertyScopeWhere(ctx);

  const properties = await prisma.property.findMany({
    where: scopedWhere,
    select: { id: true },
  });
  const propertyIds = properties.map((p) => p.id);

  const [snapshots, totalAssets, criticalAssets, openIssues, criticalIssues, recentEvents] =
    await Promise.all([
      getLatestHealthSnapshots(propertyIds),
      prisma.asset.count({ where: { propertyId: { in: propertyIds }, status: "ACTIVE" } }),
      prisma.asset.count({
        where: { propertyId: { in: propertyIds }, status: "ACTIVE", criticalityScore: { gte: 4 } },
      }),
      prisma.issue.count({
        where: {
          propertyId: { in: propertyIds },
          status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] },
        },
      }),
      prisma.issue.count({
        where: {
          propertyId: { in: propertyIds },
          severity: "CRITICAL",
          status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] },
        },
      }),
      prisma.event.findMany({
        where: { propertyId: { in: propertyIds } },
        orderBy: { createdAt: "desc" },
        take: 15,
        include: { property: { select: { id: true, name: true } }, actor: { select: { name: true } } },
      }),
    ]);

  const bandCounts: Record<string, number> = {
    Excellent: 0,
    Good: 0,
    "Needs Attention": 0,
    Poor: 0,
    Critical: 0,
  };
  let capitalExposure12mo = 0;
  let capitalExposure24mo = 0;
  let capitalExposure36mo = 0;
  let healthSum = 0;
  let riskSum = 0;

  const worstProperties: Array<{
    propertyId: string;
    healthScore: number;
    riskScore: number;
    capitalExposure12mo: number;
  }> = [];

  for (const s of snapshots) {
    const band = healthBandFor(s.healthScore);
    bandCounts[band] = (bandCounts[band] ?? 0) + 1;
    capitalExposure12mo += s.capitalExposure12mo;
    capitalExposure24mo += s.capitalExposure24mo;
    capitalExposure36mo += s.capitalExposure36mo;
    healthSum += s.healthScore;
    riskSum += s.riskScore;
    worstProperties.push({
      propertyId: s.propertyId,
      healthScore: s.healthScore,
      riskScore: s.riskScore,
      capitalExposure12mo: s.capitalExposure12mo,
    });
  }
  worstProperties.sort((a, b) => a.healthScore - b.healthScore);

  const propertyNames = await prisma.property.findMany({
    where: { id: { in: worstProperties.slice(0, 10).map((w) => w.propertyId) } },
    select: { id: true, name: true, city: true, state: true },
  });
  const nameById = new Map(propertyNames.map((p) => [p.id, p]));

  const assessedProperties = await prisma.assessment.groupBy({
    by: ["propertyId"],
    where: { propertyId: { in: propertyIds }, status: "COMPLETED" },
    _max: { completedAt: true },
  });
  const overdueThreshold = new Date(Date.now() - 365 * 86400000);
  const assessmentsOverdue = assessedProperties.filter(
    (a) => !a._max.completedAt || a._max.completedAt < overdueThreshold,
  ).length;
  const neverAssessed = propertyIds.length - assessedProperties.length;

  return {
    totalProperties: propertyIds.length,
    bandCounts,
    portfolioHealthScore: snapshots.length ? Math.round((healthSum / snapshots.length) * 10) / 10 : 0,
    portfolioRiskScore: snapshots.length ? Math.round((riskSum / snapshots.length) * 10) / 10 : 0,
    totalAssets,
    criticalAssets,
    openIssues,
    criticalIssues,
    assessmentsOverdue,
    neverAssessed,
    capitalExposure: {
      next12mo: capitalExposure12mo,
      next24mo: capitalExposure24mo,
      next36mo: capitalExposure36mo,
    },
    highestPriorityProperties: worstProperties.slice(0, 10).map((w) => ({
      ...w,
      name: nameById.get(w.propertyId)?.name,
      city: nameById.get(w.propertyId)?.city,
      state: nameById.get(w.propertyId)?.state,
      band: healthBandFor(w.healthScore),
    })),
    recentActivity: recentEvents.map((e) => ({
      id: e.id,
      type: e.type,
      createdAt: e.createdAt,
      propertyId: e.property?.id,
      propertyName: e.property?.name,
      actorName: e.actor?.name,
      payload: e.payload,
    })),
  };
}

export type PortfolioDashboard = Awaited<ReturnType<typeof getPortfolioDashboard>>;
