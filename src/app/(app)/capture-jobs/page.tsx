import Link from "next/link";
import { redirect } from "next/navigation";
import { can, getSessionContext } from "@/lib/session-context";
import { listCaptureJobs } from "@/lib/capture-job-service";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/format";

/**
 * Capture jobs — work ordered from capture subcontractors.
 *
 * For a subcontractor this is the whole product: the list is already scoped
 * in the service to their own open jobs, so they see what they owe and
 * nothing else about the customer's portfolio.
 */
export default async function CaptureJobsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.organizationId || !can(ctx, "canPerformCapture")) redirect("/dashboard");

  const jobs = await listCaptureJobs(ctx);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Capture Jobs</h1>
        <p className="mt-1 text-sm text-muted">
          Sites a capture vendor has been sent to, what each one owes, and whether it has been delivered.
        </p>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title="No capture jobs"
          description="A capture job sends a vendor to a set of sites for a defined list of deliverables. Issuing one is also what gives that vendor access to those sites — and accepting it takes the access away again."
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul>
              {jobs.map((job) => {
                const accepted = job.sites.filter((s) => s.status === "ACCEPTED").length;
                const overdue =
                  job.dueDate && job.status !== "ACCEPTED" && new Date(job.dueDate) < new Date();
                return (
                  <li key={job.id} className="border-b border-border last:border-0">
                    <Link
                      href={`/capture-jobs/${job.id}`}
                      className="flex items-center justify-between gap-4 px-5 py-3.5 transition hover:bg-background"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{job.title}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {job.vendor?.name ?? "No vendor assigned"} · {job.sites.length}{" "}
                          {job.sites.length === 1 ? "site" : "sites"} · {accepted} accepted
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs">
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
      )}
    </div>
  );
}
