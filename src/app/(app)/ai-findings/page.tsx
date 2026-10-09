import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { listFindings } from "@/lib/ai-finding-service";
import { formatDate } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FindingReviewCard, type FindingView } from "@/components/ai-findings/FindingReviewCard";

/**
 * The AI findings queue: what a vision model thinks it saw, waiting for a
 * person to say yes or no. Nothing here has changed any issue, score or cost
 * until someone confirms it.
 */
export default async function AIFindingsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canPerformAssessments")) redirect("/dashboard");
  const { view } = await searchParams;
  const status = view === "confirmed" ? "HUMAN_VERIFIED" : view === "rejected" ? "REJECTED" : "SUGGESTED";

  const findings = await listFindings(ctx, status);
  const propertyIds = [...new Set(findings.map((f) => f.evidence.propertyId).filter((id): id is string => !!id))];
  const [rules, assets] = await Promise.all([
    prisma.defectRule.findMany({ where: { organizationId: ctx.organizationId } }),
    prisma.asset.findMany({
      where: { propertyId: { in: propertyIds }, status: "ACTIVE" },
      select: { id: true, name: true, propertyId: true, conditionScore: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const ruleFor = new Map(rules.map((r) => [r.defectClass, r]));

  const views: FindingView[] = findings.map((f) => {
    const rule = f.defectClass ? ruleFor.get(f.defectClass) : undefined;
    return {
      id: f.id,
      label: f.label,
      defectClass: f.defectClass,
      confidence: f.confidence,
      modelName: f.modelName,
      imageUrl: `/api/v1/evidence/${f.evidence.id}/content`,
      box: (f.boundingBox as FindingView["box"]) ?? null,
      propertyName: f.evidence.property?.name ?? "",
      foundAt: formatDate(f.createdAt),
      assetId: f.assetId,
      assets: assets
        .filter((a) => a.propertyId === f.evidence.propertyId)
        .map((a) => ({ id: a.id, label: a.conditionScore !== null ? `${a.name} (condition ${a.conditionScore})` : a.name })),
      rule: rule
        ? {
            label: rule.label,
            severity: rule.defaultSeverity,
            costCents: rule.defaultRepairCostCents,
            penalty: rule.conditionPenalty,
          }
        : null,
      reviewedBy: f.reviewedBy?.name ?? null,
      reviewNote: f.reviewNote,
      issue: f.issue,
    };
  });

  const tab = (key: string, label: string) => {
    const active = (key === "pending" && status === "SUGGESTED") || (key === "confirmed" && status === "HUMAN_VERIFIED") || (key === "rejected" && status === "REJECTED");
    return (
      <Link
        href={key === "pending" ? "/ai-findings" : `/ai-findings?view=${key}`}
        className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-brand text-white" : "text-muted hover:text-foreground"}`}
        aria-current={active ? "page" : undefined}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">AI findings</h1>
        <p className="max-w-2xl text-sm text-muted">
          Defects a vision model thinks it saw in your photos. Nothing changes — no issue, no score, no cost — until you
          confirm one. The suggested severity, cost and condition hit come from your organization&apos;s defect rules, and
          you can change any of them before confirming.
        </p>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label="Finding status">
        {tab("pending", "Waiting for review")}
        {tab("confirmed", "Confirmed")}
        {tab("rejected", "Rejected")}
      </nav>

      {views.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title={status === "SUGGESTED" ? "Nothing waiting for review" : "Nothing here yet"}
              description={
                status === "SUGGESTED"
                  ? "When a vision model sends findings for your photos, they appear here for you to confirm or reject."
                  : undefined
              }
            />
          </CardBody>
        </Card>
      ) : status === "SUGGESTED" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {views.map((v) => (
            <FindingReviewCard key={v.id} finding={v} />
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader title={status === "HUMAN_VERIFIED" ? "Confirmed findings" : "Rejected findings"} />
          <CardBody className="p-0">
            <ul>
              {views.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3 text-sm last:border-0">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{v.label}</p>
                    <p className="text-xs text-muted">
                      {v.propertyName} · found {v.foundAt}
                      {v.reviewedBy ? ` · ${status === "HUMAN_VERIFIED" ? "confirmed" : "rejected"} by ${v.reviewedBy}` : ""}
                      {v.reviewNote ? ` · “${v.reviewNote}”` : ""}
                    </p>
                  </div>
                  {v.issue ? (
                    <Link href={`/issues/${v.issue.id}`} className="text-sm font-medium text-brand">
                      Open issue
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
