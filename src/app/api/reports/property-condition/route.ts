import { getSessionContext, propertyScopeWhere } from "@/lib/session-context";
import { requirePermission } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { toCsv, csvResponse } from "@/lib/csv";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { getPropertyReportData } from "@/lib/reports/property-report-data";
import { renderPropertyConditionPdf } from "@/lib/reports/pdf-renderer";

/**
 * Property Condition Report (spec §33, §16). Pulls from the same Asset
 * table every other view reads — no separate report database. CSV for
 * portfolio-wide asset lists; PDF for a single property's full report
 * (requires ?propertyId=).
 */
export async function GET(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    requirePermission(ctx, "canViewFinancialExposure");
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const propertyId = url.searchParams.get("propertyId");
  const format = url.searchParams.get("format") ?? "csv";

  if (format === "pdf") {
    if (!propertyId) return new Response("propertyId is required for PDF reports", { status: 400 });
    let data;
    try {
      data = await getPropertyReportData(ctx, propertyId);
    } catch {
      return new Response("Property not found", { status: 404 });
    }
    const pdf = await renderPropertyConditionPdf(data);
    await Promise.all([
      writeAuditLog({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "report.exported", metadata: { reportType: "property-condition", format: "pdf", propertyId } }),
      emitEvent({ organizationId: ctx.organizationId, propertyId, type: EVENT_TYPES.REPORT_GENERATED, actorUserId: ctx.userId, payload: { reportType: "property-condition", format: "pdf" } }),
    ]);
    return new Response(pdf as unknown as BodyInit, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="property-condition-report.pdf"` },
    });
  }

  const where = propertyId
    ? { AND: [{ propertyId }, { property: propertyScopeWhere(ctx) }] }
    : { property: propertyScopeWhere(ctx) };

  const assets = await prisma.asset.findMany({
    where,
    include: { property: { select: { name: true, customerPropertyId: true } } },
    orderBy: [{ propertyId: "asc" }, { conditionScore: "asc" }],
  });

  const csv = toCsv(
    assets.map((a) => ({
      property: a.property.name,
      propertyId: a.property.customerPropertyId ?? "",
      asset: a.name,
      assetType: a.assetType,
      criticality: a.criticalityScore,
      conditionScore: a.conditionScore ?? "",
      healthScore: a.healthScore ?? "",
      replacementCostUsd: a.replacementCost ? (a.replacementCost / 100).toFixed(2) : "",
      status: a.status,
    })),
  );

  await Promise.all([
    writeAuditLog({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "report.exported", metadata: { reportType: "property-condition", propertyId } }),
    propertyId
      ? emitEvent({ organizationId: ctx.organizationId, propertyId, type: EVENT_TYPES.REPORT_GENERATED, actorUserId: ctx.userId, payload: { reportType: "property-condition" } })
      : Promise.resolve(),
  ]);

  return csvResponse("property-condition-report.csv", csv || "property,asset,assetType,criticality,conditionScore,healthScore,replacementCostUsd,status\n");
}
