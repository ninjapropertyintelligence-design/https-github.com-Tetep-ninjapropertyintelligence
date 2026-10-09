import { redirect } from "next/navigation";
import { can, getSessionContext } from "@/lib/session-context";
import { DEFAULT_DEFECT_RULES, listEffectiveDefectRules } from "@/lib/defect-rules";
import { SCORING_CATEGORIES } from "@/lib/scoring-categories";
import { DefectRulesManager } from "@/components/settings/DefectRulesManager";
import { recordProductEvent } from "@/lib/analytics";

/**
 * The defect rulebook: what a CONFIRMED AI photo finding does to the
 * numbers. Readable by anyone who can see financial exposure, since the
 * repair costs here land in it; editable only with `canManageProperties`.
 * The API enforces both again.
 */
export default async function DefectRulesPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.organizationId || !can(ctx, "canViewFinancialExposure")) redirect("/dashboard");

  await recordProductEvent(ctx, "defect_rules.viewed");
  const rules = await listEffectiveDefectRules(ctx.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Defect Rules</h1>
        <p className="text-sm text-muted">{ctx.organizationName}</p>
      </div>

      <p className="max-w-3xl text-sm leading-relaxed text-foreground">
        When an inspector confirms an AI photo finding, its defect class is looked up here. The rule takes a fixed
        number of points off the asset&apos;s condition score and opens an issue with this severity and repair
        estimate, which flows into capital exposure. The AI never decides these numbers. Changes apply to findings
        confirmed from now on; issues already created keep the numbers they were created with.
      </p>

      <DefectRulesManager
        rules={rules}
        defaults={DEFAULT_DEFECT_RULES.map((r) => ({ ...r }))}
        categories={SCORING_CATEGORIES.filter((c) => c !== "Issues")}
        canEdit={can(ctx, "canManageProperties")}
      />
    </div>
  );
}
