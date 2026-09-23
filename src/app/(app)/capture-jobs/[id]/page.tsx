import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can, getSessionContext } from "@/lib/session-context";
import { getCaptureJob, outstandingDeliverables } from "@/lib/capture-job-service";
import { ApiError } from "@/lib/api-error";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { CaptureSiteActions } from "@/components/capture/CaptureSiteActions";
import { CaptureUploadPanel } from "@/components/capture/CaptureUploadPanel";
import { formatDate } from "@/lib/format";
import { Role } from "@/generated/prisma/client";

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
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.organizationId || !can(ctx, "canPerformCapture")) redirect("/dashboard");

  const { id } = await params;
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

  const isVendor = ctx.role === Role.VENDOR;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/capture-jobs" className="text-sm text-muted hover:text-foreground">
          ← Capture Jobs
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">{job.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {job.vendor?.name ?? "No vendor assigned"} · {job.status.toLowerCase()}
          {job.dueDate ? ` · due ${formatDate(job.dueDate)}` : " · no due date"}
        </p>
        {job.instructions ? (
          <p className="mt-3 max-w-2xl rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground">
            {job.instructions}
          </p>
        ) : null}
      </div>

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
                      <Link
                        href={`/properties/${site.propertyId}`}
                        className="font-medium text-foreground hover:text-brand"
                      >
                        {site.property.name}
                      </Link>
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
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
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
                      shots={site.shots.map((shot) => ({
                        id: shot.id,
                        label: shot.label,
                        kind: shot.kind,
                        captured: shot._count.evidence > 0,
                      }))}
                      disabled={site.status === "ACCEPTED" || !["ISSUED", "SUBMITTED", "REJECTED"].includes(job.status)}
                    />
                  ) : null}

                  <CaptureSiteActions
                    jobId={job.id}
                    siteId={site.id}
                    status={site.status}
                    jobStatus={job.status}
                    missingCount={missing.length}
                    isVendor={isVendor}
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
