import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/Badge";
import { AssessmentRunner } from "@/components/assessment/AssessmentRunner";

export default async function AssessmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const { id } = await params;

  const assessment = await prisma.assessment.findFirst({
    where: { AND: [{ id }, { property: propertyScopeWhere(ctx) }] },
    include: {
      property: { select: { id: true, name: true } },
      template: { include: { sections: { include: { questions: { orderBy: { position: "asc" } } }, orderBy: { position: "asc" } } } },
      answers: true,
      inspector: { select: { name: true } },
    },
  });
  if (!assessment) notFound();

  const readOnly = assessment.status === "COMPLETED" || (assessment.inspectorId !== ctx.userId && !ctx.permissions.includes("canManageAssessmentTemplates"));

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/properties/${assessment.property.id}`} className="text-xs text-muted hover:text-brand">
          ← {assessment.property.name}
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{assessment.template.name}</h1>
          <StatusBadge status={assessment.status} />
        </div>
        <p className="text-sm text-muted">Inspector: {assessment.inspector.name}</p>
      </div>

      <AssessmentRunner
        assessmentId={assessment.id}
        sections={assessment.template.sections.map((section) => ({
          ...section,
          questions: section.questions.map((q) => ({ ...q, options: Array.isArray(q.options) ? (q.options as string[]) : [] })),
        }))}
        initialAnswers={assessment.answers.map((a) => ({ ...a, selectValues: Array.isArray(a.selectValues) ? (a.selectValues as string[]) : [] }))}
        status={assessment.status}
        readOnly={readOnly}
      />
    </div>
  );
}
