import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, isPlatformOperator } from "@/lib/session-context";
import { getOrganizationCaptureSetup, listCustomerOrganizations } from "@/lib/platform-capture-service";
import { Card, CardBody } from "@/components/ui/Card";
import { OrganizationPicker } from "@/components/admin/OrganizationPicker";
import { NewCaptureJobForm } from "@/components/admin/NewCaptureJobForm";

/** The platform team ordering capture work on one customer's sites. */
export default async function NewCaptureJobPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!isPlatformOperator(ctx)) redirect("/dashboard");

  const organizations = await listCustomerOrganizations(ctx);
  const orgParam = (await searchParams).org;
  const orgId = typeof orgParam === "string" && organizations.some((o) => o.id === orgParam) ? orgParam : "";
  const setup = orgId ? await getOrganizationCaptureSetup(ctx, orgId) : null;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/capture-jobs" className="text-sm text-muted hover:text-foreground">
          ← Capture Jobs
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">New capture job</h1>
        <p className="mt-1 text-sm text-muted">
          Choose the customer, the sites (or add a new one), the vendor and what they must capture. The vendor sees
          only these sites, and only until you approve the work.
        </p>
      </div>

      <OrganizationPicker organizations={organizations} value={orgId} />

      {setup ? (
        <Card>
          <CardBody>
            <NewCaptureJobForm
              key={setup.organization.id}
              organizationId={setup.organization.id}
              vendors={setup.vendors.map((v) => ({ id: v.id, label: v.trade ? `${v.name} — ${v.trade}` : v.name }))}
              portfolios={setup.portfolios}
              properties={setup.properties.map((p) => ({
                id: p.id,
                label: [p.name, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" — "),
                region: p.region?.name ?? null,
              }))}
            />
            {setup.vendors.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                This customer has no vendor companies yet.{" "}
                <Link href={`/admin/vendors?org=${setup.organization.id}`} className="font-medium text-brand hover:underline">
                  Add one on the Vendors page →
                </Link>
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
