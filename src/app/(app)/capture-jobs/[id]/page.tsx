import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can, contextForCaptureJob, getSessionContext, isPlatformOperator } from "@/lib/session-context";
import { getCaptureJob, outstandingDeliverables } from "@/lib/capture-job-service";
import { ApiError } from "@/lib/api-error";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { CaptureSiteActions } from "@/components/capture/CaptureSiteActions";
import { CaptureUploadPanel } from "@/components/capture/CaptureUploadPanel";
import { AIPhotoReviewPanel, type SitePhoto } from "@/components/capture/AIPhotoReviewPanel";
import { getSitePhotoFindings } from "@/lib/ai/photo-analysis";
import { parseStoredBox } from "@/lib/ai/bounding-box";
import { prisma } from "@/lib/prisma";
import { ShotPinEditor } from "@/components/capture/ShotPinEditor";
import { formatDate } from "@/lib/format";
import { Role } from "@/generated/prisma/client";
import { IssueJobButton } from "@/components/admin/VendorManager";
import { CaptureJobMap } from "@/components/capture/CaptureJobMap";
import { VendorSiteImports } from "@/components/capture/VendorSiteImports";
import { ConditionScoreForm } from "@/components/capture/ConditionScoreForm";
import { DeliveredDroneWork, type DeliveredDroneCapture } from "@/components/capture/DeliveredDroneWork";
import { getStorageProvider } from "@/lib/storage";
import { captureReviewWhere } from "@/lib/tenant-scope";
import { evidenceScopeWhere } from "@/lib/tenant-scope";

/**
 * Matches the palette the rest of the app uses for status: Tailwind's own
 * scale via `ui/Badge`, not invented `success`/`danger` tokens — this design
 * system has no such colours, and a class that does not resolve renders as
 * nothing while still type-checking and linting cleanly.
 */
const SITE_STATUS_STYLE: Record<string, string> = {
  PENDING: "border-zinc-200 bg-zinc-50 text-zinc-600",
  IN_PROGRESS: "border-amber-200 bg-amber-50 text-amber-700",
  SUBMITTED: "border-blue-200 bg-blue-50 text-blue-700",
  ACCEPTED: "border-green-200 bg-green-50 text-green-700",
  REJECTED: "border-red-200 bg-red-50 text-red-700",
};

export default async function CaptureJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  const { id } = await params;

  // The platform team opens any customer's job: bound to that customer here.
  const isPlatform = isPlatformOperator(session);
  const ctx = await contextForCaptureJob(session, id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  if (!ctx.organizationId || (!isPlatform && !can(ctx, "canPerformCapture"))) redirect("/dashboard");

  const job = await getCaptureJob(ctx, id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });

  // What each site still owes, computed from the data rather than stored, so
  // it cannot drift from what has actually been delivered.
  const outstanding = new Map(
    await Promise.all(
      job.sites.map(async (site) => [site.id, (await outstandingDeliverables(site.id)).missing] as const),
    ),
  );

  // Photos with their AI findings, and the assets each site's photos can be
  // rated against. Loaded per site so a vendor's view stays scoped to their
  // own uploads (see `getSitePhotoFindings`).
  const photosBySite = new Map<string, SitePhoto[]>(
    await Promise.all(
      job.sites.map(async (site) => {
        const rows = await getSitePhotoFindings(ctx, site.id);
        const photos: SitePhoto[] = rows.map((row) => ({
          id: row.id,
          assetId: row.assetId,
          label: row.captureShot?.label ?? `Photo uploaded ${formatDate(row.createdAt)}`,
          analysis: row.analysisJob ? { status: row.analysisJob.status, error: row.analysisJob.lastError } : null,
          findings: row.aiFindings.map((f) => ({
            id: f.id,
            status: f.status,
            label: f.label,
            description: f.description,
            suggestedScore: f.suggestedScore,
            suggestedSeverity: f.suggestedSeverity,
            confidence: f.confidence,
            defects: Array.isArray(f.defects) ? (f.defects as unknown as SitePhoto["findings"][number]["defects"]) : [],
            recommendedAction: f.recommendedAction,
            confirmedScore: f.confirmedScore,
            assetName: f.asset?.name ?? null,
            defectClass: f.defectClass,
            currentScore: f.asset?.conditionScore ?? null,
            rule: f.rule
              ? {
                  conditionHit: f.rule.conditionHit,
                  repairCostCents: f.rule.repairCostCents,
                  defaultSeverity: f.rule.defaultSeverity,
                  source: f.rule.source,
                }
              : null,
            issueId: f.issueId,
            // Parsed here, server side: the column is JSON, and the client
            // should only ever receive a box that is safe to draw.
            boundingBox: parseStoredBox(f.boundingBox),
            imageWidth: f.imageWidth,
            imageHeight: f.imageHeight,
          })),
        }));
        return [site.id, photos] as const;
      }),
    ),
  );
  const isVendor = ctx.role === Role.VENDOR;
  // A vendor needs a site's assets to say which one their photos show, so
  // they are loaded for every site the vendor can upload to; anyone else
  // only needs them where there are photos to rate.
  const assetsByProperty = new Map<string, Array<{ id: string; name: string }>>();
  for (const site of job.sites) {
    const needed = isVendor || (photosBySite.get(site.id) ?? []).length > 0;
    if (!needed || assetsByProperty.has(site.propertyId)) continue;
    assetsByProperty.set(
      site.propertyId,
      await prisma.asset.findMany({
        where: { propertyId: site.propertyId, organizationId: ctx.organizationId, status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    );
  }

  // Which of the vendor's own accounts are connected, for the pickers on each site.
  const vendorConnections =
    isVendor && ctx.vendorId
      ? await prisma.vendorConnection.findMany({ where: { vendorId: ctx.vendorId }, select: { provider: true } })
      : [];
  const connected = {
    DRONEDEPLOY: vendorConnections.some((c) => c.provider === "DRONEDEPLOY"),
    MATTERPORT: vendorConnections.some((c) => c.provider === "MATTERPORT"),
  };

  const autoAnalyze = isVendor
    ? ((await prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { autoAnalyzePhotos: true } }))
        ?.autoAnalyzePhotos ?? false)
    : false;
  // Where the delivered photos were actually taken, for the job map. Scoped
  // like every other read, so the customer sees them only once approved.
  const locatedPhotos = await prisma.evidence.findMany({
    where: {
      captureJobSiteId: { in: job.sites.map((s) => s.id) },
      latitude: { not: null },
      longitude: { not: null },
      ...evidenceScopeWhere(ctx),
    },
    select: { id: true, captureJobSiteId: true, latitude: true, longitude: true },
    take: 2000,
  });

  // Drone work delivered on each site — map, layers, raw photos — so it can be
  // judged here before approval. Read through the review filter like
  // everything else, so the customer sees it only once approved.
  const storage = getStorageProvider();
  const droneCaptures = await prisma.droneCapture.findMany({
    where: { captureJobSiteId: { in: job.sites.map((s) => s.id) }, ...captureReviewWhere(ctx) },
    orderBy: { createdAt: "desc" },
    include: {
      datasets: {
        include: {
          outputs: { orderBy: { createdAt: "asc" } },
          images: { orderBy: { createdAt: "asc" }, take: 12, select: { id: true, storageKey: true } },
          _count: { select: { images: true } },
        },
      },
    },
  });
  const droneBySite = new Map<string, DeliveredDroneCapture[]>();
  for (const capture of droneCaptures) {
    const outputs = capture.datasets.flatMap((d) => d.outputs);
    const images = capture.datasets.flatMap((d) => d.images).slice(0, 12);
    const imageCount = capture.datasets.reduce((n, d) => n + d._count.images, 0);
    if (outputs.length === 0 && imageCount === 0 && capture.status !== "PROCESSING") continue;
    const entry: DeliveredDroneCapture = {
      id: capture.id,
      status: capture.status,
      notes: capture.notes,
      imageCount,
      outputs: await Promise.all(
        outputs.map(async (o) => ({
          id: o.id,
          outputType: o.outputType,
          storageKey: o.storageKey,
          downloadUrl: await storage.getDownloadUrl(o.storageKey),
          preview: (o.metadata as { preview?: boolean } | null)?.preview === true,
        })),
      ),
      images: await Promise.all(images.map(async (i) => ({ id: i.id, downloadUrl: await storage.getDownloadUrl(i.storageKey) }))),
    };
    const list = droneBySite.get(capture.captureJobSiteId!) ?? [];
    list.push(entry);
    droneBySite.set(capture.captureJobSiteId!, list);
  }

  const canPlacePins = can(ctx, "canManageCaptureJobs") && job.status !== "ACCEPTED" && job.status !== "CANCELLED";
  const canReview = can(ctx, "canReviewCaptures");

  return (
    <div className="space-y-5">
      <div>
        <Link href={isPlatform ? "/admin/capture-jobs" : "/capture-jobs"} className="text-sm text-muted hover:text-foreground">
          ← Capture Jobs
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">{job.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {isPlatform ? `${ctx.organizationName} · ` : ""}
          {job.vendor?.name ?? "No vendor assigned"} · {job.status.toLowerCase()}
          {job.dueDate ? ` · due ${formatDate(job.dueDate)}` : " · no due date"}
        </p>
        {job.instructions ? (
          <p className="mt-3 max-w-2xl rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground">
            {job.instructions}
          </p>
        ) : null}
      </div>

      {job.status === "DRAFT" && can(ctx, "canManageCaptureJobs") ? (
        <IssueJobButton jobId={job.id} hasVendor={job.vendorId !== null} />
      ) : null}

      <CaptureJobMap
        token={process.env.NEXT_PUBLIC_MAPBOX_TOKEN || null}
        sites={job.sites.map((site) => ({
          id: site.id,
          name: site.property.name,
          status: site.status,
          latitude: site.property.latitude,
          longitude: site.property.longitude,
          shots: site.shots.map((shot) => ({
            id: shot.id,
            label: shot.label,
            sequence: shot.sequence,
            captured: shot._count.evidence > 0,
            latitude: shot.latitude,
            longitude: shot.longitude,
          })),
          photos: locatedPhotos
            .filter((p) => p.captureJobSiteId === site.id)
            .map((p) => ({ id: p.id, latitude: p.latitude!, longitude: p.longitude! })),
        }))}
      />

      <Card>
        <CardHeader title={`Sites (${job.sites.length})`} />
        <CardBody className="p-0">
          <ul>
            {job.sites.map((site) => {
              const missing = outstanding.get(site.id) ?? [];
              return (
                <li key={site.id} className="border-b border-border px-5 py-4 last:border-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      {isPlatform ? (
                        // The property pages are the customer's; the platform team works from the job.
                        <p className="font-medium text-foreground">{site.property.name}</p>
                      ) : (
                        <Link
                          href={`/properties/${site.propertyId}`}
                          className="font-medium text-foreground hover:text-brand"
                        >
                          {site.property.name}
                        </Link>
                      )}
                      <p className="mt-0.5 text-xs text-muted">
                        {site.property.addressLine1}, {site.property.city} {site.property.state}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
                        SITE_STATUS_STYLE[site.status] ?? "border-zinc-200 bg-zinc-50 text-zinc-600"
                      }`}
                    >
                      {site.status.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {site.deliverables.map((d) => {
                      const done = !missing.includes(d);
                      return (
                        <span
                          key={d}
                          title={done ? "Delivered since this job was issued" : "Still outstanding"}
                          className={`rounded-full border px-2.5 py-1 text-xs ${
                            done ? "border-green-200 bg-green-50 text-green-700" : "border-border text-muted"
                          }`}
                        >
                          {done ? "✓ " : ""}
                          {d.replace(/_/g, " ").toLowerCase()}
                        </span>
                      );
                    })}
                  </div>

                  {site.shots.length > 0 ? (
                    <div className="mt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Route ({site.shots.filter((s) => s._count.evidence > 0).length}/{site.shots.length})
                      </p>
                      <ol className="mt-1.5 space-y-1">
                        {site.shots.map((shot) => {
                          const captured = shot._count.evidence > 0;
                          return (
                            <li key={shot.id} className="flex items-start gap-2 text-sm">
                              <span
                                aria-hidden
                                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px] ${
                                  captured
                                    ? "border-green-300 bg-green-50 text-green-700"
                                    : "border-border text-muted"
                                }`}
                              >
                                {captured ? "✓" : shot.sequence}
                              </span>
                              <span className={captured ? "text-foreground" : "text-muted"}>
                                {shot.label}
                                <span className="ml-1.5 text-xs text-muted">
                                  {shot.kind === "IMAGE_360" ? "360°" : "photo"}
                                  {shot.required ? "" : " · optional"}
                                  {captured ? ` · ${shot._count.evidence}` : ""}
                                  {shot.latitude !== null ? " · 📍" : ""}
                                </span>
                                {shot.notes ? <span className="block text-xs text-muted">{shot.notes}</span> : null}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  ) : null}

                  {canPlacePins && site.shots.length > 0 ? (
                    <ShotPinEditor
                      jobId={job.id}
                      siteId={site.id}
                      token={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? null}
                      site={{ name: site.property.name, latitude: site.property.latitude, longitude: site.property.longitude }}
                      shots={site.shots.map((shot) => ({
                        id: shot.id,
                        label: shot.label,
                        sequence: shot.sequence,
                        latitude: shot.latitude,
                        longitude: shot.longitude,
                      }))}
                    />
                  ) : null}

                  {site.rejectionReason ? (
                    <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      Sent back: {site.rejectionReason}
                    </p>
                  ) : null}

                  {isVendor ? (
                    <CaptureUploadPanel
                      jobId={job.id}
                      siteId={site.id}
                      propertyId={site.propertyId}
                      propertyLocation={
                        site.property.latitude !== null && site.property.longitude !== null
                          ? { latitude: site.property.latitude, longitude: site.property.longitude }
                          : null
                      }
                      jobTitle={job.title}
                      shots={site.shots.map((shot) => ({
                        id: shot.id,
                        label: shot.label,
                        kind: shot.kind,
                        captured: shot._count.evidence > 0,
                        sequence: shot.sequence,
                        latitude: shot.latitude,
                        longitude: shot.longitude,
                      }))}
                      disabled={site.status === "ACCEPTED" || !["ISSUED", "SUBMITTED", "REJECTED"].includes(job.status)}
                      assets={assetsByProperty.get(site.propertyId) ?? []}
                      autoAnalyze={autoAnalyze}
                    />
                  ) : null}

                  {isVendor && site.status !== "ACCEPTED" && ["ISSUED", "SUBMITTED", "REJECTED"].includes(job.status) ? (
                    <>
                      <VendorSiteImports
                        jobId={job.id}
                        siteId={site.id}
                        deliverables={site.deliverables}
                        connected={connected}
                      />
                      {site.deliverables.includes("CONDITION_SCORES") ? (
                        <ConditionScoreForm
                          jobId={job.id}
                          siteId={site.id}
                          assets={assetsByProperty.get(site.propertyId) ?? []}
                        />
                      ) : null}
                    </>
                  ) : null}

                  <DeliveredDroneWork captures={droneBySite.get(site.id) ?? []} />

                  <AIPhotoReviewPanel
                    photos={photosBySite.get(site.id) ?? []}
                    assets={assetsByProperty.get(site.propertyId) ?? []}
                    // The AI findings feed the customer's own issue and condition workflow, so the
                    // platform team looks at the photos here without acting on the findings.
                    disabled={
                      isPlatform || site.status === "ACCEPTED" || !["ISSUED", "SUBMITTED", "REJECTED"].includes(job.status)
                    }
                    canOpenIssues={!isVendor && !isPlatform}
                  />

                  <CaptureSiteActions
                    jobId={job.id}
                    siteId={site.id}
                    status={site.status}
                    jobStatus={job.status}
                    missingCount={missing.length}
                    isVendor={isVendor}
                    canReview={canReview}
                  />
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <p className="max-w-3xl text-xs leading-relaxed text-muted">
        Condition scores are what move a property&apos;s health score — imagery on its own only raises data
        confidence. A job that does not ask for condition scores buys pictures and changes no number.
      </p>
    </div>
  );
}
