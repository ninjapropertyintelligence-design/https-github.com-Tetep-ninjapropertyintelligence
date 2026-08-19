import { redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";

export default async function ReportsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canViewFinancialExposure")) redirect("/dashboard");

  const reports = [
    { title: "Portfolio Capital Exposure Report", description: "Health, risk, and CapEx by property, org-wide (or filtered to your scope).", href: "/api/v1/reports/capital-exposure?format=csv" },
    { title: "Portfolio Property Condition Report", description: "Every asset's condition, criticality, and replacement cost across your scope.", href: "/api/v1/reports/property-condition?format=csv" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Reports</h1>
        <p className="text-sm text-muted">Generated from the same live data as your dashboards — CSV today, PDF/Excel planned next.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {reports.map((r) => (
          <Card key={r.href}>
            <CardHeader title={r.title} subtitle={r.description} />
            <CardBody>
              <a href={r.href} className="text-sm font-medium text-brand hover:underline">
                Download CSV →
              </a>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
