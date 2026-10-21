import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { TemplateBuilder } from "@/components/assessment/TemplateBuilder";
import { getVocabulary } from "@/lib/tag-service";
import { getTemplateDefinition } from "@/lib/template-service";
import { ApiError } from "@/lib/api-error";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canManageAssessmentTemplates")) redirect("/assessments");
  const tagTypes = (await getVocabulary(ctx)).map((t) => ({ id: t.id, name: t.name, allowMultiple: t.allowMultiple, values: t.values }));
  const { id } = await params;
  const template = await getTemplateDefinition(ctx, id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  });
  if (!template) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/assessments/templates" className="text-xs text-muted hover:text-brand">
          ← Templates
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-foreground">
          {template.definition.name}
          {!template.isActive ? <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 align-middle text-xs font-normal text-muted">Retired</span> : null}
        </h1>
      </div>
      {/* Keyed by id: saving as a new version navigates here with a new template, and the builder must start from it. */}
      <TemplateBuilder key={template.id} templateId={template.id} initial={template.definition} usedBy={template.usedBy} tagTypes={tagTypes} />
    </div>
  );
}
