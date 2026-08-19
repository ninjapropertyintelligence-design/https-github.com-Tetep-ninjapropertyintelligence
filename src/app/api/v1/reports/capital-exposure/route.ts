import { getSessionContext, propertyScopeWhere } from "@/lib/session-context";
import { requirePermission } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { getLatestHealthSnapshots } from "@/lib/scoring";
import { toCsv, csvResponse } from "@/lib/csv";
import { writeAuditLog } from "@/lib/audit";

/** Capital Exposure Report (spec §33, item 28's "Issue -> CapEx flow"). */
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

  const properties = await prisma.property.findMany({
    where: propertyId ? { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] } : propertyScopeWhere(ctx),
    select: { id: true, name: true, customerPropertyId: true },
  });
  const snapshots = await getLatestHealthSnapshots(properties.map((p) => p.id));
  const snapByProperty = new Map(snapshots.map((s) => [s.propertyId, s]));

  const csv = toCsv(
    properties.map((p) => {
      const snap = snapByProperty.get(p.id);
      return {
        property: p.name,
        propertyId: p.customerPropertyId ?? "",
        healthScore: snap?.healthScore ?? "",
        riskScore: snap?.riskScore ?? "",
        exposure12moUsd: snap ? (snap.capitalExposure12mo / 100).toFixed(2) : "0.00",
        exposure24moUsd: snap ? (snap.capitalExposure24mo / 100).toFixed(2) : "0.00",
        exposure36moUsd: snap ? (snap.capitalExposure36mo / 100).toFixed(2) : "0.00",
      };
    }),
  );

  await writeAuditLog({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "report.exported", metadata: { reportType: "capital-exposure", propertyId } });

  return csvResponse("capital-exposure-report.csv", csv || "property,healthScore,riskScore,exposure12moUsd,exposure24moUsd,exposure36moUsd\n");
}
