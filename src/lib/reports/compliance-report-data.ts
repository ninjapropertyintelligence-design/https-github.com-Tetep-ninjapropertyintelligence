import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { captureReviewWhere, propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { assertMayReadExpiries, listExpiries } from "@/lib/expiry-service";
import { listContractors } from "@/lib/contractor-service";
import { calendarDay, complianceStatusFor, evidenceBasis, isoDay, type ComplianceStatus } from "@/lib/expiry-rules";
import { getMatterportProvider } from "@/lib/integrations/matterport-provider";

/**
 * Everything a compliance and inspection record for one store says, gathered
 * once, so the PDF and any other rendering read the same numbers.
 *
 * Written for someone outside the company, an insurer or an auditor, so
 * every date states how it came to be on record, and nothing is dressed up:
 * a date read by software and not yet checked says so.
 */

export interface ExpiryRegisterRow {
  kind: string;
  label: string | null;
  equipment: string | null;
  expiresOn: string;
  daysLeft: number;
  status: ComplianceStatus;
  lastInspectedOn: string | null;
  servicedBy: string | null;
  basis: string;
  photoOnFile: boolean;
}

export async function getComplianceReportData(ctx: SessionContext, propertyId: string, now: Date = new Date()) {
  // Permission first: "you may not see this at all" is a truer answer than
  // "no such store" for a login that was never meant to.
  assertMayReadExpiries(ctx);
  const property = await prisma.property.findFirst({
    where: { AND: [{ id: propertyId }, { organizationId: ctx.organizationId }, propertyScopeWhere(ctx)] },
    include: { organization: { select: { name: true } } },
  });
  if (!property) throw new ApiError(404, "Property not found");
  const today = calendarDay(now);

  const [allExpiries, equipment, contractors, tourLink, panoramaCount, latestFlight, openCritical] = await Promise.all([
    listExpiries(ctx, { propertyId, status: "ALL", now }),
    prisma.asset.findMany({
      where: { propertyId, status: "ACTIVE" },
      include: { area: { select: { name: true } }, serviceVendor: { select: { name: true, contactPhone: true, emergencyPhone: true } } },
      orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
      take: 500,
    }),
    listContractors(ctx, { propertyId }),
    prisma.matterportPropertyLink.findFirst({
      where: { propertyId, ...captureReviewWhere(ctx) },
      orderBy: { linkedAt: "desc" },
      include: { space: { select: { externalSpaceId: true, name: true, syncedAt: true } } },
    }),
    prisma.evidence.count({ where: { propertyId, type: "IMAGE_360", ...captureReviewWhere(ctx) } }),
    prisma.droneCapture.findFirst({
      where: { propertyId, status: "READY", ...captureReviewWhere(ctx) },
      orderBy: { capturedAt: { sort: "desc", nulls: "last" } },
      select: { capturedAt: true, droneDeployImport: { select: { id: true } } },
    }),
    prisma.issue.count({ where: { propertyId, severity: "CRITICAL", status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } } }),
  ]);

  const active = allExpiries.filter((i) => i.status === "ACTIVE");
  const register: ExpiryRegisterRow[] = active.map((i) => ({
    kind: i.kind,
    label: i.label,
    equipment: i.asset?.name ?? null,
    expiresOn: isoDay(i.expiresAt),
    daysLeft: i.daysLeft,
    status: complianceStatusFor(i.daysLeft),
    lastInspectedOn: i.lastInspectedAt ? isoDay(i.lastInspectedAt) : null,
    servicedBy: i.servicedBy ?? i.asset?.serviceVendor?.name ?? null,
    basis: evidenceBasis({ source: i.source, needsReview: i.needsReview, hasPhoto: !!i.evidenceId }),
    photoOnFile: !!i.evidenceId,
  }));

  // What was renewed in the last two years: a record of upkeep, not only of what is current.
  const since = new Date(today.getTime() - 730 * 86_400_000);
  const history = allExpiries
    .filter((i) => i.status === "RENEWED" && i.updatedAt >= since)
    .map((i) => ({ kind: i.kind, label: i.label, equipment: i.asset?.name ?? null, wasDueOn: isoDay(i.expiresAt), renewedOn: isoDay(i.updatedAt) }))
    .sort((a, b) => b.renewedOn.localeCompare(a.renewedOn));

  const embedUrl = tourLink ? getMatterportProvider().getViewerConfig(tourLink.space.externalSpaceId).embedUrl : null;
  return {
    property,
    organizationName: property.organization.name,
    asOf: isoDay(today),
    generatedAt: now,
    summary: {
      tracked: register.length,
      current: register.filter((r) => r.status === "Current").length,
      dueSoon: register.filter((r) => r.status === "Due soon").length,
      expired: register.filter((r) => r.status === "Expired").length,
      unconfirmed: active.filter((i) => i.needsReview).length,
    },
    register,
    history,
    equipment: equipment.map((a) => ({
      name: a.name,
      assetType: a.assetType,
      zone: a.area?.name ?? null,
      manufacturer: a.manufacturer,
      model: a.model,
      serialNumber: a.serialNumber,
      installedOn: a.installedAt ? isoDay(a.installedAt) : null,
      conditionScore: a.conditionScore,
      servicedBy: a.serviceVendor ? { name: a.serviceVendor.name, phone: a.serviceVendor.contactPhone, afterHours: a.serviceVendor.emergencyPhone } : null,
    })),
    contractors: contractors.map((c) => ({
      name: c.name,
      trade: c.trade,
      contactName: c.contactName,
      phone: c.contactPhone,
      afterHoursPhone: c.emergencyPhone,
      email: c.contactEmail,
    })),
    coverage: {
      tour: tourLink ? { name: tourLink.space.name, syncedOn: tourLink.space.syncedAt ? isoDay(tourLink.space.syncedAt) : null, hasViewer: !!embedUrl } : null,
      panoramas: panoramaCount,
      aerial: latestFlight
        ? { flownOn: latestFlight.capturedAt ? isoDay(latestFlight.capturedAt) : null, fromDroneDeploy: !!latestFlight.droneDeployImport }
        : null,
    },
    openCriticalIssues: openCritical,
  };
}

export type ComplianceReportData = Awaited<ReturnType<typeof getComplianceReportData>>;
