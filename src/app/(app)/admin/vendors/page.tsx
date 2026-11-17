import { redirect } from "next/navigation";
import { getSessionContext, isPlatformOperator } from "@/lib/session-context";
import { listCustomerOrganizations, listOrganizationVendors } from "@/lib/platform-capture-service";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { OrganizationPicker } from "@/components/admin/OrganizationPicker";
import { AddVendorForm, VendorLoginForm } from "@/components/admin/VendorManager";
import { formatDate } from "@/lib/format";

/**
 * Vendor companies and their logins, per customer.
 *
 * A vendor is added to the customer whose sites it will capture, and its
 * people sign in to that customer's account — where they see only the sites
 * on their open capture jobs.
 */
export default async function PlatformVendorsPage({
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
  const vendors = orgId ? await listOrganizationVendors(ctx, orgId) : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Vendors</h1>
        <p className="mt-1 text-sm text-muted">
          The capture companies you send to customers&apos; sites, and the people who sign in for them.
        </p>
      </div>

      <OrganizationPicker organizations={organizations} value={orgId} />

      {vendors ? (
        <>
          <AddVendorForm key={orgId} organizationId={orgId} />
          {vendors.length === 0 ? (
            <p className="text-sm text-muted">No vendor companies for this customer yet.</p>
          ) : (
            vendors.map((v) => (
              <Card key={v.id}>
                <CardHeader
                  title={v.name}
                  subtitle={[v.trade, v.contactEmail, v.contactPhone, `${v._count.captureJobs} capture jobs`]
                    .filter(Boolean)
                    .join(" · ")}
                />
                <CardBody className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Logins</p>
                    {v.memberships.length === 0 && v.invitations.length === 0 ? (
                      <p className="mt-1 text-sm text-muted">Nobody can sign in for this vendor yet.</p>
                    ) : (
                      <ul className="mt-1 space-y-1 text-sm">
                        {v.memberships.map((m) => (
                          <li key={m.id} className="text-foreground">
                            {m.user.name} <span className="text-muted">· {m.user.email}</span>
                            {m.user.isActive ? null : <span className="text-muted"> · deactivated</span>}
                          </li>
                        ))}
                        {v.invitations.map((inv) => (
                          <li key={inv.id} className="text-muted">
                            {inv.email} · invited, link expires {formatDate(inv.expiresAt)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <VendorLoginForm vendorId={v.id} vendorName={v.name} />
                </CardBody>
              </Card>
            ))
          )}
        </>
      ) : null}
    </div>
  );
}
