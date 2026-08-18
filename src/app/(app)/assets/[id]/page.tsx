import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere, can } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCents, formatDate } from "@/lib/format";
import { ConditionUpdateForm } from "@/components/asset/ConditionUpdateForm";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const { id } = await params;

  const asset = await prisma.asset.findFirst({
    where: { AND: [{ id }, { property: propertyScopeWhere(ctx) }] },
    include: { property: { select: { id: true, name: true } }, system: true, conditionHistory: { orderBy: { changedAt: "desc" }, take: 20, include: { changedBy: { select: { name: true } } } } },
  });
  if (!asset) notFound();

  const [openIssues, documents] = await Promise.all([
    prisma.issue.findMany({ where: { assetId: asset.id, status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } } }),
    prisma.document.findMany({ where: { assetId: asset.id } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/properties/${asset.property.id}`} className="text-xs text-muted hover:text-brand">
          ← {asset.property.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-foreground">{asset.name}</h1>
        <p className="text-sm text-muted">{asset.assetType}{asset.manufacturer ? ` · ${asset.manufacturer}` : ""}{asset.model ? ` ${asset.model}` : ""}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Condition" value={asset.conditionScore ?? "—"} />
        <StatTile label="Health" value={asset.healthScore ?? "—"} tone={asset.healthScore !== null && asset.healthScore < 50 ? "critical" : "default"} />
        <StatTile label="Criticality" value={`${asset.criticalityScore}/5`} tone={asset.criticalityScore >= 4 ? "warning" : "default"} />
        <StatTile label="Replacement Cost" value={asset.replacementCost ? formatCents(asset.replacementCost) : "—"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Condition History" subtitle="Append-only — every change is preserved" />
          <CardBody className="p-0">
            {asset.conditionHistory.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No condition history yet" />
              </div>
            ) : (
              <ul>
                {asset.conditionHistory.map((h) => (
                  <li key={h.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
                    <div>
                      <span className="tabular-nums font-medium text-foreground">
                        {h.previousScore ?? "—"} → {h.newScore}
                      </span>
                      {h.reason ? <p className="text-xs text-muted">{h.reason}</p> : null}
                    </div>
                    <div className="text-right text-xs text-muted">
                      <p>{h.changedBy?.name ?? "System"}</p>
                      <p>{formatDate(h.changedAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Update Condition" />
          <CardBody>
            {can(ctx, "canManageAssets") ? (
              <ConditionUpdateForm assetId={asset.id} currentScore={asset.conditionScore} version={asset.version} />
            ) : (
              <p className="text-sm text-muted">You don&apos;t have permission to update asset condition.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Open Issues" />
          <CardBody className="p-0">
            {openIssues.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No open issues" />
              </div>
            ) : (
              <ul>
                {openIssues.map((i) => (
                  <li key={i.id} className="border-b border-border px-5 py-2.5 text-sm last:border-0">
                    <Link href={`/issues/${i.id}`} className="font-medium text-foreground hover:text-brand">
                      {i.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Documents" />
          <CardBody className="p-0">
            {documents.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No documents linked" />
              </div>
            ) : (
              <ul>
                {documents.map((d) => (
                  <li key={d.id} className="border-b border-border px-5 py-2.5 text-sm last:border-0">
                    {d.title}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
