import { prisma } from "@/lib/prisma";
import { SessionContext, propertyScopeWhere } from "@/lib/tenant-scope";
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

  /**
   * The counts below filter through the `property` RELATION rather than an
   * `IN (...)` list of ids.
   *
   * This is not a style preference. Postgres sends bind parameters with a
   * 16-bit count, so one parameter per property put a hard ceiling on the
   * whole dashboard: measured against synthetic portfolios, Prisma refused at
   * 65,000 ids with "The query parameter limit supported by your database is
   * exceeded" and the raw snapshot query failed at 70,000 with a bare
   * protocol error. An organization that grew past ~65k properties would have
   * found its dashboard simply stopped loading.
   *
   * A relation filter pushes the same scope into a join, so the statement
   * carries a handful of parameters no matter how large the portfolio is.
   * `propertyScopeWhere` remains the single authority on what is visible.
   */
  const [
    propertyIds,
    totalProperties,
    totalAssets,
    criticalAssets,
    openIssues,
    criticalIssues,
    recentEvents,
  ] = await Promise.all([
    prisma.property.findMany({ where: scopedWhere, select: { id: true } }).then((rows) => rows.map((r) => r.id)),
    prisma.property.count({ where: scopedWhere }),
    prisma.asset.count({ where: { property: scopedWhere, status: "ACTIVE" } }),
    prisma.asset.count({
      where: { property: scopedWhere, status: "ACTIVE", criticalityScore: { gte: 4 } },
    }),
    prisma.issue.count({
      where: {
        property: scopedWhere,
        status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] },
      },
    }),
    prisma.issue.count({
      where: {
        property: scopedWhere,
        severity: "CRITICAL",
        status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] },
      },
    }),
    prisma.event.findMany({
      where: { property: scopedWhere },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { property: { select: { id: true, name: true } }, actor: { select: { name: true } } },
    }),
  ]);

  // Still id-based, because the snapshot query is raw SQL and keeping the
  // scope in Prisma means it cannot drift from the rule everything else uses.
  // `getLatestHealthSnapshots` chunks internally so the ceiling above cannot
  // reappear here.
  const snapshots = await getLatestHealthSnapshots(propertyIds);

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
    where: { property: scopedWhere, status: "COMPLETED" },
    _max: { completedAt: true },
  });
  const overdueThreshold = new Date(Date.now() - 365 * 86400000);
  const assessmentsOverdue = assessedProperties.filter(
    (a) => !a._max.completedAt || a._max.completedAt < overdueThreshold,
  ).length;
  const neverAssessed = totalProperties - assessedProperties.length;

  return {
    totalProperties,
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
