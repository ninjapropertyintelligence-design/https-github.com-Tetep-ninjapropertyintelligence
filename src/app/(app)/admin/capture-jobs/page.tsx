import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, isPlatformOperator } from "@/lib/session-context";
import { listAllCaptureJobs } from "@/lib/platform-capture-service";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/format";

/**
 * Capture jobs across every customer — the platform team's work queue.
 *
 * Sites a vendor has submitted come first: until the platform team approves
 * them, the customer cannot see the work at all.
 */
export default async function PlatformCaptureJobsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!isPlatformOperator(ctx)) redirect("/dashboard");

  const jobs = await listAllCaptureJobs(ctx);
  const waiting = jobs.filter((j) => j.awaitingReview > 0);
  const others = jobs.filter((j) => j.awaitingReview === 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Capture Jobs</h1>
          <p className="mt-1 text-sm text-muted">
            Send vendors to customers&apos; sites, then approve their work before the customer sees it.
          </p>
        </div>
        <Link
          href="/admin/capture-jobs/new"
          className="inline-flex items-center justify-center rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90"
        >
          New capture job
        </Link>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title="No capture jobs yet"
          description="Create a job to send a vendor to a customer's sites. Add the vendor company and its login on the Vendors page first."
        />
      ) : (
        <>
          <JobList title="Waiting for your approval" subtitle="Vendors have submitted these sites" jobs={waiting} highlight />
          <JobList title="All jobs" jobs={others} />
        </>
      )}
    </div>
  );
}

function JobList({
  title,
  subtitle,
  jobs,
  highlight = false,
}: {
  title: string;
  subtitle?: string;
  jobs: Awaited<ReturnType<typeof listAllCaptureJobs>>;
  highlight?: boolean;
}) {
  if (jobs.length === 0) return null;
  return (
    <Card className={highlight ? "border-blue-200" : ""}>
      <CardHeader title={`${title} (${jobs.length})`} subtitle={subtitle} />
      <CardBody className="p-0">
        <ul>
          {jobs.map((job) => {
            const accepted = job.sites.filter((s) => s.status === "ACCEPTED").length;
            const overdue = job.dueDate && job.status !== "ACCEPTED" && new Date(job.dueDate) < new Date();
            return (
              <li key={job.id} className="border-b border-border last:border-0">
                <Link
                  href={`/capture-jobs/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 transition hover:bg-background"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{job.title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {job.organization.name} · {job.vendor?.name ?? "No vendor assigned"} · {job.sites.length}{" "}
                      {job.sites.length === 1 ? "site" : "sites"} · {accepted} approved
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    {job.awaitingReview > 0 ? (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-semibold text-blue-700">
                        {job.awaitingReview} to approve
                      </span>
                    ) : null}
                    {job.dueDate ? (
                      <span className={overdue ? "font-semibold text-red-600" : "text-muted"}>
                        {overdue ? "Overdue " : "Due "}
                        {formatDate(job.dueDate)}
                      </span>
                    ) : (
                      <span className="text-muted">No due date</span>
                    )}
                    <span className="rounded-full border border-border px-2.5 py-1 font-semibold uppercase tracking-wide text-muted">
                      {job.status.toLowerCase()}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
