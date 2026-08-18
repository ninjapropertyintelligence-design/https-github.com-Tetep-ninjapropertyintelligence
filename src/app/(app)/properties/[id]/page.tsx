import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere, can, SessionContext } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { getLatestHealthSnapshot, getDataConfidenceWarnings, CategoryBreakdownEntry } from "@/lib/scoring";
import { ScoringCategory } from "@/lib/scoring-categories";
import { getPropertyInteriorStatus } from "@/lib/matterport-service";
import { getPropertyExteriorData } from "@/lib/drone-service";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { formatCents, formatDate, eventLabel, formatRelativeTime } from "@/lib/format";
import { PropertyTabs } from "@/components/property/PropertyTabs";
import { PropertyHeaderStats } from "@/components/property/PropertyHeaderStats";
import { OverviewTab } from "@/components/property/OverviewTab";
import { DocumentSearchBox } from "@/components/property/DocumentSearchBox";
import { AskAiInline } from "@/components/ai/AskAiInline";
import { InteriorManager, InteriorStatusData } from "@/components/interior/InteriorManager";
import { ExteriorManager, DroneCaptureData, MarkerData } from "@/components/exterior/ExteriorManager";

async function loadProperty(propertyId: string, ctx: Awaited<ReturnType<typeof getSessionContext>>) {
  if (!ctx) return null;
  return prisma.property.findFirst({ where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] } });
}

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const { id } = await params;
  const { tab = "overview" } = await searchParams;

  const property = await loadProperty(id, ctx);
  if (!property) notFound();

  const health = await getLatestHealthSnapshot(property.id);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <Link href="/properties" className="text-xs text-muted hover:text-brand">
            ← Properties
          </Link>
          {can(ctx, "canManageProperties") ? (
            <Link href={`/properties/${property.id}/onboarding`} className="text-xs font-medium text-brand hover:underline">
              Deep Property Setup →
            </Link>
          ) : null}
        </div>
        <h1 className="mt-1 text-xl font-semibold text-foreground">{property.name}</h1>
        <p className="text-sm text-muted">
          {property.addressLine1}, {property.city}, {property.state}
          {property.customerPropertyId ? ` · ${property.customerPropertyId}` : ""}
        </p>
        <div className="mt-2">
          <PropertyHeaderStats health={health} />
        </div>
      </div>

      <PropertyTabs propertyId={property.id} active={tab} />

      <TabContent propertyId={property.id} tab={tab} propertyName={property.name} ctx={ctx} />
    </div>
  );
}

async function TabContent({ propertyId, tab, propertyName, ctx }: { propertyId: string; tab: string; propertyName: string; ctx: SessionContext }) {
  const canViewAI = ctx.permissions.includes("canViewAI");
  switch (tab) {
    case "assets":
      return <AssetsTab propertyId={propertyId} />;
    case "issues":
      return <IssuesTab propertyId={propertyId} />;
    case "assessments":
      return <AssessmentsTab propertyId={propertyId} />;
    case "documents":
      return <DocumentsTab propertyId={propertyId} />;
    case "history":
      return <HistoryTab propertyId={propertyId} />;
    case "interior":
      return <InteriorTab propertyId={propertyId} ctx={ctx} />;
    case "exterior":
      return <ExteriorTab propertyId={propertyId} ctx={ctx} />;
    case "digital-twin":
      return <DigitalTwinTab propertyId={propertyId} />;
    case "projects":
      return (
        <EmptyState
          title="Projects — coming in a later phase"
          description="Capital projects will roll up cost and scheduling across multiple issues/assets. For now, cost tracking lives on individual Issues."
        />
      );
    case "reports":
      return <ReportsTab propertyId={propertyId} propertyName={propertyName} />;
    case "ai":
      return canViewAI ? (
        <AskAiInline placeholder="What's wrong with this property?" propertyId={propertyId} propertyName={propertyName} />
      ) : (
        <EmptyState title="AI is not enabled for your role" />
      );
    default:
      return <OverviewTabLoader propertyId={propertyId} />;
  }
}

async function OverviewTabLoader({ propertyId }: { propertyId: string }) {
  const [property, health, openIssueCount, criticalIssueCount, assetCount, criticalAssetCount, lastAssessment, matterportLink, droneCapture, warnings] =
    await Promise.all([
      prisma.property.findUniqueOrThrow({ where: { id: propertyId } }),
      getLatestHealthSnapshot(propertyId),
      prisma.issue.count({ where: { propertyId, status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } } }),
      prisma.issue.count({ where: { propertyId, severity: "CRITICAL", status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } } }),
      prisma.asset.count({ where: { propertyId, status: "ACTIVE" } }),
      prisma.asset.count({ where: { propertyId, status: "ACTIVE", criticalityScore: { gte: 4 } } }),
      prisma.assessment.findFirst({ where: { propertyId, status: "COMPLETED" }, orderBy: { completedAt: "desc" } }),
      prisma.matterportPropertyLink.findFirst({ where: { propertyId }, orderBy: { linkedAt: "desc" } }),
      prisma.droneCapture.findFirst({ where: { propertyId, status: "READY" }, orderBy: { capturedAt: "desc" } }),
      getDataConfidenceWarnings(propertyId),
    ]);

  return (
    <OverviewTab
      property={property}
      health={
        health
          ? {
              ...health,
              categoryBreakdown: health.categoryBreakdown as unknown as Record<ScoringCategory, CategoryBreakdownEntry>,
            }
          : null
      }
      counts={{ openIssues: openIssueCount, criticalIssues: criticalIssueCount, assetCount, criticalAssetCount }}
      lastAssessment={lastAssessment?.completedAt ?? null}
      lastInteriorCapture={matterportLink?.linkedAt ?? null}
      lastExteriorCapture={droneCapture?.capturedAt ?? null}
      warnings={warnings}
    />
  );
}

async function AssetsTab({ propertyId }: { propertyId: string }) {
  const assets = await prisma.asset.findMany({ where: { propertyId }, orderBy: { healthScore: "asc" } });
  if (assets.length === 0) {
    return <EmptyState title="No assets recorded yet" description="Add assets to start tracking condition, cost, and history for this property." />;
  }
  return (
    <Card>
      <CardBody className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-5 py-2.5 font-medium">Asset</th>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 font-medium">Criticality</th>
              <th className="px-3 py-2.5 font-medium">Condition</th>
              <th className="px-3 py-2.5 font-medium">Health</th>
              <th className="px-5 py-2.5 text-right font-medium">Replacement Cost</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0 hover:bg-zinc-50">
                <td className="px-5 py-3">
                  <Link href={`/assets/${a.id}`} className="font-medium text-foreground hover:text-brand">
                    {a.name}
                  </Link>
                  {a.serialNumber ? <p className="text-xs text-muted">SN: {a.serialNumber}</p> : null}
                </td>
                <td className="px-3 py-3 text-muted">{a.assetType}</td>
                <td className="px-3 py-3 tabular-nums">{a.criticalityScore}</td>
                <td className="px-3 py-3 tabular-nums">{a.conditionScore ?? "—"}</td>
                <td className="px-3 py-3 tabular-nums">{a.healthScore ?? "—"}</td>
                <td className="px-5 py-3 text-right tabular-nums">{a.replacementCost ? formatCents(a.replacementCost) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

async function IssuesTab({ propertyId }: { propertyId: string }) {
  const issues = await prisma.issue.findMany({
    where: { propertyId },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    include: { asset: { select: { name: true } } },
  });
  if (issues.length === 0) {
    return <EmptyState title="No issues recorded" description="Issues from assessments, drone/Matterport review, or manual reports will show up here." />;
  }
  return (
    <div className="space-y-2">
      {issues.map((issue) => (
        <Card key={issue.id}>
          <CardBody className="flex items-center justify-between">
            <div>
              <Link href={`/issues/${issue.id}`} className="font-medium text-foreground hover:text-brand">
                {issue.title}
              </Link>
              <p className="text-xs text-muted">
                {issue.asset ? `${issue.asset.name} · ` : ""}
                {issue.estimatedCost ? `est. ${formatCents(issue.estimatedCost)}` : "no estimate"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={issue.status} />
              <SeverityBadge severity={issue.severity} />
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

async function AssessmentsTab({ propertyId }: { propertyId: string }) {
  const assessments = await prisma.assessment.findMany({
    where: { propertyId },
    orderBy: { createdAt: "desc" },
    include: { template: { select: { name: true } }, inspector: { select: { name: true } } },
  });
  if (assessments.length === 0) {
    return <EmptyState title="No assessments yet" description="Scheduled and completed assessments for this property will appear here." />;
  }
  return (
    <Card>
      <CardBody className="p-0">
        <ul>
          {assessments.map((a) => (
            <li key={a.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
              <div>
                <Link href={`/assessments/${a.id}`} className="font-medium text-foreground hover:text-brand">
                  {a.template.name}
                </Link>
                <p className="text-xs text-muted">Inspector: {a.inspector.name}</p>
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
  );
}

async function DocumentsTab({ propertyId }: { propertyId: string }) {
  const documents = await prisma.document.findMany({ where: { propertyId }, orderBy: { updatedAt: "desc" }, include: { versions: { take: 1, orderBy: { versionNumber: "desc" } } } });
  return (
    <div>
      <DocumentSearchBox propertyId={propertyId} />
      {documents.length === 0 ? (
        <EmptyState title="No documents uploaded" description="Warranties, inspection reports, permits, and floor plans will appear here." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul>
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
                  <div>
                    <p className="font-medium text-foreground">{d.title}</p>
                    <p className="text-xs text-muted">
                      {d.documentType.replace(/_/g, " ")}
                      {d.indexStatus === "INDEXED" ? " · text indexed" : d.indexStatus === "UNSUPPORTED" ? " · not text-searchable" : d.indexStatus === "FAILED" ? " · indexing failed" : ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted">{formatDate(d.updatedAt)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

async function HistoryTab({ propertyId }: { propertyId: string }) {
  const events = await prisma.event.findMany({ where: { propertyId }, orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { name: true } } } });
  if (events.length === 0) {
    return <EmptyState title="No history yet" description="Every property update, capture, condition change, and issue is recorded here automatically." />;
  }
  return (
    <Card>
      <CardBody className="p-0">
        <ul>
          {events.map((e) => (
            <li key={e.id} className="flex items-center justify-between border-b border-border px-5 py-2.5 text-sm last:border-0">
              <div>
                <p className="text-foreground">{eventLabel(e.type)}</p>
                {e.actor ? <p className="text-xs text-muted">{e.actor.name}</p> : null}
              </div>
              <span className="text-xs text-muted">{formatRelativeTime(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

async function InteriorTab({ propertyId, ctx }: { propertyId: string; ctx: SessionContext }) {
  const status = await getPropertyInteriorStatus(ctx, propertyId);
  return (
    <InteriorManager
      propertyId={propertyId}
      data={status as unknown as InteriorStatusData}
      canManageIntegrations={can(ctx, "canManageIntegrations")}
      canPerformCapture={can(ctx, "canPerformCapture")}
    />
  );
}

async function ExteriorTab({ propertyId, ctx }: { propertyId: string; ctx: SessionContext }) {
  const [{ captures, markers }, assets, issues] = await Promise.all([
    getPropertyExteriorData(ctx, propertyId),
    prisma.asset.findMany({ where: { propertyId, status: "ACTIVE" }, select: { id: true, name: true }, take: 200 }),
    prisma.issue.findMany({
      where: { propertyId, status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } },
      select: { id: true, title: true, severity: true },
      take: 200,
    }),
  ]);
  return (
    <ExteriorManager
      propertyId={propertyId}
      captures={captures as unknown as DroneCaptureData[]}
      markers={markers as unknown as MarkerData[]}
      canPerformCapture={can(ctx, "canPerformCapture")}
      canManageAssets={can(ctx, "canManageAssets")}
      assets={assets}
      issues={issues}
    />
  );
}

async function DigitalTwinTab({ propertyId }: { propertyId: string }) {
  const pointClouds = await prisma.droneOutput.findMany({
    where: { outputType: { in: ["POINT_CLOUD", "MESH_3D"] }, dataset: { capture: { propertyId } } },
  });
  return (
    <Card>
      <CardHeader title="Digital Twin" subtitle="Point cloud / mesh outputs from drone processing" />
      <CardBody>
        {pointClouds.length === 0 ? (
          <EmptyState title="No 3D twin data yet" description="Point cloud and mesh outputs from drone processing jobs will be listed here." />
        ) : (
          <ul className="space-y-1 text-sm">
            {pointClouds.map((o) => (
              <li key={o.id}>{o.outputType} — {formatDate(o.createdAt)}</li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

async function ReportsTab({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  return (
    <Card>
      <CardHeader title="Reports" />
      <CardBody className="space-y-2 text-sm">
        <p className="text-muted">Generate a report for {propertyName}:</p>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/reports/property-condition?propertyId=${propertyId}&format=pdf`} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-zinc-50">
            Property Condition Report (PDF)
          </a>
          <a href={`/api/reports/executive-summary?propertyId=${propertyId}`} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-zinc-50">
            Executive Summary (PDF)
          </a>
          <a href={`/api/reports/property-condition?propertyId=${propertyId}&format=csv`} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-zinc-50">
            Property Condition Report (CSV)
          </a>
          <a href={`/api/reports/capital-exposure?propertyId=${propertyId}&format=csv`} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-zinc-50">
            Capital Exposure Report (CSV)
          </a>
        </div>
      </CardBody>
    </Card>
  );
}
