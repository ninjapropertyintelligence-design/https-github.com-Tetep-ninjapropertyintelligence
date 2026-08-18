import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/format";

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const params = await searchParams;

  const mineByDefault = ctx.role === "INSPECTOR" || ctx.role === "TECHNICIAN";
  const overdue = params.status === "overdue";

  const assessments = await prisma.assessment.findMany({
    where: {
      organizationId: ctx.organizationId,
      property: propertyScopeWhere(ctx),
      ...(mineByDefault ? { inspectorId: ctx.userId } : {}),
      ...(overdue ? { status: { in: ["DRAFT", "IN_PROGRESS"] }, scheduledFor: { lt: new Date() } } : {}),
    },
    orderBy: { scheduledFor: "asc" },
    include: { property: { select: { id: true, name: true } }, template: { select: { name: true } }, inspector: { select: { name: true } } },
    take: 100,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Assessments</h1>
        <p className="text-sm text-muted">{assessments.length} assessments{mineByDefault ? " assigned to you" : " in scope"}</p>
      </div>

      {assessments.length === 0 ? (
        <EmptyState title="No assessments" description="Assessments scheduled or completed for your properties will appear here." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul>
              {assessments.map((a) => (
                <li key={a.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
                  <div>
                    <Link href={`/assessments/${a.id}`} className="font-medium text-foreground hover:text-brand">
                      {a.template.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {a.property.name} · Inspector: {a.inspector.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={a.status} />
                    <p className="mt-1 text-xs text-muted">{formatDate(a.completedAt ?? a.scheduledFor)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
