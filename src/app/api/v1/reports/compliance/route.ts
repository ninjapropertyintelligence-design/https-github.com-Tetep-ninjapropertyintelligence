import { getSessionContext, mfaPolicySatisfied } from "@/lib/session-context";
import { ApiError } from "@/lib/api-error";
import { toCsv, csvResponse } from "@/lib/csv";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { listExpiries } from "@/lib/expiry-service";
import { complianceStatusFor, evidenceBasis, isoDay } from "@/lib/expiry-rules";
import { getComplianceReportData } from "@/lib/reports/compliance-report-data";
import { renderComplianceReportPdf } from "@/lib/reports/pdf-renderer";

/**
 * Compliance and Inspection Record, for insurers and auditors.
 *   ?propertyId=&format=pdf  one store's full record
 *   ?format=csv              the expiration register for every store in scope
 *                            (or one store with ?propertyId=)
 * Resolves the session itself, as the other report routes do, so the org MFA
 * policy is re-checked by hand.
 */
export async function GET(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!mfaPolicySatisfied(ctx)) {
    return new Response("Your organization requires multi-factor authentication.", { status: 403 });
  }

  const url = new URL(req.url);
  const propertyId = url.searchParams.get("propertyId");
  const format = url.searchParams.get("format") ?? "csv";

  try {
    if (format === "pdf") {
      if (!propertyId) return new Response("propertyId is required for the PDF record", { status: 400 });
      const data = await getComplianceReportData(ctx, propertyId);
      const pdf = await renderComplianceReportPdf(data);
      await Promise.all([
        writeAuditLog({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "report.exported", metadata: { reportType: "compliance", format: "pdf", propertyId } }),
        emitEvent({ organizationId: ctx.organizationId, propertyId, type: EVENT_TYPES.REPORT_GENERATED, actorUserId: ctx.userId, payload: { reportType: "compliance", format: "pdf" } }),
      ]);
      const safeName = data.property.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "store";
      return new Response(pdf as unknown as BodyInit, {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="compliance-record-${safeName}.pdf"` },
      });
    }

    const items = await listExpiries(ctx, { propertyId: propertyId ?? undefined });
    const csv = toCsv(
      items.map((i) => ({
        store: i.property.name,
        equipment: i.asset?.name ?? "",
        item: i.kind,
        label: i.label ?? "",
        expires: isoDay(i.expiresAt),
        daysLeft: i.daysLeft,
        status: complianceStatusFor(i.daysLeft),
        lastInspected: i.lastInspectedAt ? isoDay(i.lastInspectedAt) : "",
        servicedBy: i.servicedBy ?? i.asset?.serviceVendor?.name ?? "",
        basis: evidenceBasis({ source: i.source, needsReview: i.needsReview, hasPhoto: !!i.evidenceId }),
        photoOnFile: i.evidenceId ? "yes" : "no",
      })),
    );
    await writeAuditLog({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "report.exported", metadata: { reportType: "compliance", format: "csv", propertyId } });
    return csvResponse("compliance-register.csv", csv || "store,equipment,item,label,expires,daysLeft,status,lastInspected,servicedBy,basis,photoOnFile\n");
  } catch (err) {
    if (err instanceof ApiError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
