import { redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { listDefectRules } from "@/lib/ai-finding-service";
import { DefectRulesEditor } from "@/components/ai-findings/DefectRulesEditor";

/**
 * What each defect class means to this organization. The AI only names a
 * class; these rules turn it into the severity, cost and condition hit an
 * inspector is offered — and the inspector can still change all three.
 */
export default async function DefectRulesPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canManageAssessmentTemplates")) redirect("/dashboard");

  const rules = await listDefectRules(ctx);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Defect rules</h1>
        <p className="max-w-2xl text-sm text-muted">
          When the AI spots a defect, it only says what kind it is. These rules decide what that means here: how
          serious it is, roughly what it costs to fix, and how many points it takes off the asset&apos;s condition. They
          are suggestions — an inspector can change them on every finding.
        </p>
      </div>
      <DefectRulesEditor
        rules={rules.map((r) => ({
          id: r.id,
          defectClass: r.defectClass,
          label: r.label,
          assetCategory: r.assetCategory,
          defaultSeverity: r.defaultSeverity,
          conditionPenalty: r.conditionPenalty,
          defaultRepairCostCents: r.defaultRepairCostCents,
        }))}
      />
    </div>
  );
}
