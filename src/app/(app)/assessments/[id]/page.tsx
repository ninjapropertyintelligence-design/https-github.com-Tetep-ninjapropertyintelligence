import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/session-context";
import { StatusBadge } from "@/components/ui/Badge";
import { StatTile } from "@/components/ui/StatTile";
import { AssessmentRunner } from "@/components/assessment/AssessmentRunner";
import { getAssessmentDetail, mayWriteAssessment, progressFor } from "@/lib/assessment-service";
import { isAssessmentLocked } from "@/lib/assessment-progress";
import { hasPermission } from "@/lib/permissions";
import { formatDate } from "@/lib/format";

export default async function AssessmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const { id } = await params;

  const assessment = await getAssessmentDetail(ctx, id);
  if (!assessment) notFound();
  const progress = await progressFor(assessment);

  const canWrite = mayWriteAssessment(ctx, assessment);
  const readOnly = isAssessmentLocked(assessment.status) || !canWrite;
  const isManager = hasPermission(ctx.role, "canManageAssessmentTemplates");
  const hasTasks = progress.requiredTasks > 0 || progress.taskResponses > 0;

  const toOptions = (options: unknown) => (Array.isArray(options) ? (options as string[]) : []);

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
        <p className="text-sm text-muted">
          Inspector: {assessment.inspector.name}
          {assessment.completedAt ? ` · Completed ${formatDate(assessment.completedAt)}` : ""}
          {assessment.releasedAt ? ` · Released ${formatDate(assessment.releasedAt)}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {hasTasks ? (
          <>
            <StatTile
              label="Required tasks complete"
              value={`${progress.requiredTasksComplete} of ${progress.requiredTasks}`}
              tone={progress.requiredTasks > 0 && progress.requiredTasksComplete === progress.requiredTasks ? "good" : "default"}
            />
            <StatTile label="Task responses complete" value={progress.taskResponsesComplete} />
            <StatTile
              label="Task responses incomplete"
              value={progress.taskResponsesIncomplete}
              tone={progress.taskResponsesIncomplete > 0 ? "warning" : "default"}
            />
          </>
        ) : (
          <StatTile
            label="Required questions answered"
            value={`${progress.requiredQuestionsAnswered} of ${progress.requiredQuestions}`}
          />
        )}
        <StatTile label="Photos" value={progress.photos} />
      </div>

      <AssessmentRunner
        assessmentId={assessment.id}
        propertyId={assessment.property.id}
        sections={assessment.template.sections.map((section) => ({
          id: section.id,
          name: section.name,
          questions: section.questions.filter((q) => !q.taskId).map((q) => ({ ...q, options: toOptions(q.options) })),
          tasks: section.tasks.map((task) => ({
            ...task,
            questions: task.questions.map((q) => ({ ...q, options: toOptions(q.options) })),
          })),
        }))}
        taskResponses={assessment.taskResponses.map((r) => ({
          id: r.id,
          taskId: r.taskId,
          instance: r.instance,
          label: r.label,
          isComplete: r.isComplete,
        }))}
        initialAnswers={assessment.answers.map((a) => ({
          id: a.id,
          questionId: a.questionId,
          taskResponseId: a.taskResponseId,
          assetId: a.assetId,
          textValue: a.textValue,
          numberValue: a.numberValue,
          boolValue: a.boolValue,
          conditionValue: a.conditionValue,
          selectValues: toOptions(a.selectValues),
          files: a.evidence.map((e) => ({ id: e.id, type: e.type })),
        }))}
        status={assessment.status}
        readOnly={readOnly}
        canComplete={canWrite && !isAssessmentLocked(assessment.status)}
        canReopen={isManager && assessment.status === "COMPLETED"}
        canRelease={isManager && assessment.status === "COMPLETED"}
      />
    </div>
  );
}
