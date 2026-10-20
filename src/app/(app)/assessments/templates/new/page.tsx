import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { TemplateBuilder } from "@/components/assessment/TemplateBuilder";

export default async function NewTemplatePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canManageAssessmentTemplates")) redirect("/assessments");
  return (
    <div className="space-y-4">
      <div>
        <Link href="/assessments/templates" className="text-xs text-muted hover:text-brand">
          ← Templates
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-foreground">New template</h1>
      </div>
      <TemplateBuilder />
    </div>
  );
}
