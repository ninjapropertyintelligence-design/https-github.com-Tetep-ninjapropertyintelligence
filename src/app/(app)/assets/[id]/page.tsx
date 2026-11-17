import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere, can } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCents, formatDate } from "@/lib/format";
import { ConditionUpdateForm } from "@/components/asset/ConditionUpdateForm";
import { recordProductEvent } from "@/lib/analytics";
import { findKitchenEquipment } from "@/lib/restaurant-kitchen";
import { whoToCall } from "@/lib/contractor-service";
import { AssetContractorPicker } from "@/components/contractor/AssetContractorPicker";
import { ContractorContact } from "@/components/contractor/CallLinks";
import { getAssetLocation } from "@/lib/asset-location-service";
import { listExpiries } from "@/lib/expiry-service";
import { EXPIRY_KINDS, isoDay } from "@/lib/expiry-rules";
import { AssetLocationCard } from "@/components/asset/AssetLocationCard";
import { CountdownBadge } from "@/components/expiry/CountdownBadge";
import { ExpiryScanner } from "@/components/expiry/ExpiryScanner";
import { ExpiryRowActions } from "@/components/expiry/ExpiryRowActions";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const { id } = await params;

  const asset = await prisma.asset.findFirst({
    where: { AND: [{ id }, { property: propertyScopeWhere(ctx) }] },
    include: { property: { select: { id: true, name: true } }, area: { select: { name: true } }, system: true, conditionHistory: { orderBy: { changedAt: "desc" }, take: 20, include: { changedBy: { select: { name: true } } } } },
  });
  if (!asset) notFound();

  // Product analytics (§105). After the scope check: a blocked request is
  // not an asset view, and recording one would inflate adoption with access
  // failures. Awaited but never able to throw, and flagged automatically
  // when the viewer is support impersonating.
  await recordProductEvent(ctx, "asset.viewed");

  const [openIssues, documents] = await Promise.all([
    prisma.issue.findMany({ where: { assetId: asset.id, status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } } }),
    prisma.document.findMany({ where: { assetId: asset.id } }),
  ]);

  const kitchen = findKitchenEquipment(asset.assetType);
  const canSeeContractors = can(ctx, "canManageVendors") || can(ctx, "canViewPortfolio");
  const callList = canSeeContractors ? await whoToCall(ctx, asset.id) : null;
  const [location, expiries] = canSeeContractors
    ? await Promise.all([getAssetLocation(ctx, asset.id), listExpiries(ctx, { assetId: asset.id })])
    : [null, []];
  // Photographing a tag is for managers and the inspectors out doing it, not for a contractor's login.
  const canRecord = can(ctx, "canManageAssets") || (can(ctx, "canUploadEvidence") && ctx.role !== "VENDOR");

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

      {callList ? (
        <Card>
          <CardHeader title="Who to call" subtitle="The contractor that services this equipment" />
          <CardBody className="space-y-4">
            {callList.assigned ? (
              <div>
                <Link href={`/contractors/${callList.assigned.id}`} className="font-medium text-foreground hover:text-brand">
                  {callList.assigned.name}
                  {callList.assigned.trade ? <span className="ml-2 text-xs font-normal text-muted">{callList.assigned.trade}</span> : null}
                </Link>
                <ContractorContact c={callList.assigned} />
              </div>
            ) : (
              <p className="text-sm text-muted">No contractor is assigned to this equipment yet.</p>
            )}
            {can(ctx, "canManageAssets") ? (
              <AssetContractorPicker
                assetId={asset.id}
                currentVendorId={asset.serviceVendorId}
                options={[...(callList.assigned ? [callList.assigned] : []), ...callList.others].map((v) => ({
                  id: v.id,
                  label: v.trade ? `${v.name} (${v.trade})` : v.name,
                }))}
              />
            ) : null}
            {!callList.assigned && callList.others.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Contractors at this store</p>
                <ul className="space-y-3">
                  {callList.others.slice(0, 5).map((v) => (
                    <li key={v.id}>
                      <p className="text-sm font-medium text-foreground">
                        {v.name}
                        {v.trade ? <span className="ml-2 text-xs font-normal text-muted">{v.trade}</span> : null}
                      </p>
                      <ContractorContact c={v} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {canSeeContractors ? (
        <Card>
          <CardHeader title="Expiry dates" subtitle="Inspections and certificates on this equipment, counted down daily" />
          <CardBody className="space-y-4">
            {expiries.length === 0 ? (
              <p className="text-sm text-muted">Nothing is being counted down for this equipment yet.</p>
            ) : (
              <ul className="space-y-3">
                {expiries.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {x.kind}
                        {x.label ? <span className="font-normal text-muted"> · {x.label}</span> : null}
                      </p>
                      <p className="text-xs text-muted">
                        Expires {isoDay(x.expiresAt)}
                        {x.servicedBy ? ` · ${x.servicedBy}` : ""}
                      </p>
                      <CountdownBadge daysLeft={x.daysLeft} />
                      {x.needsReview ? <p className="text-xs text-amber-700">Read by AI from a photo. Check the date against the tag.</p> : null}
                    </div>
                    {can(ctx, "canManageAssets") ? (
                      <ExpiryRowActions id={x.id} kind={x.kind} needsReview={x.needsReview} expiresOn={isoDay(x.expiresAt)} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canRecord ? (
              <div className="space-y-3 border-t border-border pt-4">
                <ExpiryScanner
                  assetId={asset.id}
                  propertyId={asset.propertyId}
                  kinds={EXPIRY_KINDS}
                  hasContractor={!!asset.serviceVendorId}
                  canEnterByHand={can(ctx, "canManageAssets")}
                />
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {location ? <AssetLocationCard assetId={asset.id} location={location} canManage={can(ctx, "canManageAssets")} /> : null}

      {kitchen ? (
        <Card>
          <CardHeader title="Audit checkpoints" subtitle={`${asset.area?.name ?? kitchen.zone} · ${kitchen.item.function}`} />
          <CardBody>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {kitchen.item.checkpoints.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Scored 1 Pass, 2 Needs Attention, 3 Critical Fail in the Restaurant Kitchen Audit.</p>
          </CardBody>
        </Card>
      ) : null}

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
