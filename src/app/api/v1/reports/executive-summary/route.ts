import { getSessionContext, mfaPolicySatisfied } from "@/lib/session-context";
import { requirePermission } from "@/lib/api-utils";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { getPropertyReportData } from "@/lib/reports/property-report-data";
import { renderExecutiveSummaryPdf } from "@/lib/reports/pdf-renderer";

// GET /api/v1/reports/executive-summary?propertyId= — PDF only (spec §16, §33).
export async function GET(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  // This route resolves the session itself instead of going through
  // `withApiHandler` (it returns a file, not the JSON envelope), so the
  // org MFA policy has to be re-checked by hand — stepping outside the
  // wrapper means stepping outside its guards.
  if (!mfaPolicySatisfied(ctx)) {
    return new Response("Your organization requires multi-factor authentication.", { status: 403 });
  }
  try {
    requirePermission(ctx, "canViewFinancialExposure");
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const propertyId = url.searchParams.get("propertyId");
  if (!propertyId) return new Response("propertyId is required", { status: 400 });

  let data;
  try {
    data = await getPropertyReportData(ctx, propertyId);
  } catch {
    return new Response("Property not found", { status: 404 });
  }

  const pdf = await renderExecutiveSummaryPdf(data);

  await Promise.all([
    writeAuditLog({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "report.exported", metadata: { reportType: "executive-summary", propertyId } }),
    emitEvent({ organizationId: ctx.organizationId, propertyId, type: EVENT_TYPES.REPORT_GENERATED, actorUserId: ctx.userId, payload: { reportType: "executive-summary" } }),
  ]);

  return new Response(pdf as unknown as BodyInit, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="executive-summary.pdf"` },
  });
}
