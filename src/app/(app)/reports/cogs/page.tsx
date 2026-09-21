import { redirect } from "next/navigation";
import { can, getSessionContext } from "@/lib/session-context";
import { summarizePropertyCogs } from "@/lib/cost-metering";
import { CogsReport } from "@/components/reports/CogsReport";

/**
 * Property-level cost of goods sold (spec §49/§50).
 *
 * Gated on canViewFinancialExposure: this is what the business pays to serve
 * a property, which is not the same thing as what the customer is billed, and
 * not everyone who can see a property should see its margin.
 */
export default async function CogsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.organizationId || !can(ctx, "canViewFinancialExposure")) redirect("/dashboard");

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
  const report = await summarizePropertyCogs(ctx.organizationId, periodStart, periodEnd);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Cost to Serve</h1>
        <p className="text-sm text-muted">{ctx.organizationName} · last 30 days</p>
      </div>
      <div className="max-w-4xl">
        <CogsReport
          report={{
            ...report,
            periodStart: report.periodStart.toISOString(),
            periodEnd: report.periodEnd.toISOString(),
          }}
        />
      </div>
    </div>
  );
}
