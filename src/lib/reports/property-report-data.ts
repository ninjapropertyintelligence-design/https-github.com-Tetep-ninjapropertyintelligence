import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { SessionContext, propertyScopeWhere } from "@/lib/tenant-scope";
import { getLatestHealthSnapshot } from "@/lib/scoring";
import { healthBandFor } from "@/lib/scoring-categories";

/**
 * Single source of report content for one property (spec §16 property
 * report requirements). Both the Property Condition PDF and the Executive
 * Summary PDF render from this same gathered data — never two independent
 * queries producing potentially different numbers.
 */
export async function getPropertyReportData(ctx: SessionContext, propertyId: string) {
  const property = await prisma.property.findFirst({ where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] } });
  if (!property) throw new ApiError(404, "Property not found");

  const [health, assets, criticalIssues, openIssueCount, lastAssessment, matterportLink, droneCapture, evidenceCount, documentCount] =
    await Promise.all([
      getLatestHealthSnapshot(property.id),
      prisma.asset.findMany({ where: { propertyId: property.id, status: "ACTIVE" }, orderBy: { conditionScore: "asc" }, take: 10 }),
      prisma.issue.findMany({
        where: { propertyId: property.id, severity: "CRITICAL", status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.issue.count({ where: { propertyId: property.id, status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } } }),
      prisma.assessment.findFirst({ where: { propertyId: property.id, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, include: { template: true } }),
      prisma.matterportPropertyLink.findFirst({ where: { propertyId: property.id }, orderBy: { linkedAt: "desc" }, include: { space: true } }),
      prisma.droneCapture.findFirst({ where: { propertyId: property.id, status: "READY" }, orderBy: { capturedAt: "desc" } }),
      prisma.evidence.count({ where: { propertyId: property.id } }),
      prisma.document.count({ where: { propertyId: property.id } }),
    ]);

  return {
    property,
    health: health ? { ...health, band: healthBandFor(health.healthScore) } : null,
    assets,
    criticalIssues,
    openIssueCount,
    lastAssessment,
    interiorStatus: matterportLink
      ? { linked: true, spaceStatus: matterportLink.space.status, lastSync: matterportLink.space.syncedAt ?? matterportLink.linkedAt }
      : { linked: false, spaceStatus: null, lastSync: null },
    exteriorStatus: droneCapture ? { captured: true, capturedAt: droneCapture.capturedAt } : { captured: false, capturedAt: null },
    evidenceCount,
    documentCount,
  };
}

export type PropertyReportData = Awaited<ReturnType<typeof getPropertyReportData>>;
