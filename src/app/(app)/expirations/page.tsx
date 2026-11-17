import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere, can } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatTile } from "@/components/ui/StatTile";
import { listExpiries } from "@/lib/expiry-service";
import { isoDay } from "@/lib/expiry-rules";
import { CountdownBadge } from "@/components/expiry/CountdownBadge";
import { ExpiryRowActions } from "@/components/expiry/ExpiryRowActions";
import { PhoneLink } from "@/components/contractor/CallLinks";

export default async function ExpirationsPage({ searchParams }: { searchParams: Promise<{ propertyId?: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canManageAssets") && !can(ctx, "canViewPortfolio")) redirect("/dashboard");
  const { propertyId } = await searchParams;

  const [items, properties] = await Promise.all([
    listExpiries(ctx, { propertyId }),
    prisma.property.findMany({ where: propertyScopeWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);
  const canManage = can(ctx, "canManageAssets");
  const expired = items.filter((i) => i.daysLeft < 0).length;
  const soon = items.filter((i) => i.daysLeft >= 0 && i.daysLeft <= 14).length;
  const next60 = items.filter((i) => i.daysLeft > 14 && i.daysLeft <= 60).length;
  const toCheck = items.filter((i) => i.needsReview).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Expirations</h1>
        <p className="text-sm text-muted">
          Fire extinguisher tags, hood certificates, permits and more, counted down daily. The people responsible for each store are emailed as dates near.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Expired" value={expired} tone={expired > 0 ? "critical" : "default"} />
        <StatTile label="Within 14 days" value={soon} tone={soon > 0 ? "warning" : "default"} />
        <StatTile label="15 to 60 days" value={next60} />
        <StatTile label="Read by AI, to check" value={toCheck} tone={toCheck > 0 ? "warning" : "default"} sublabel="Dates read from photos" />
      </div>

      <form className="flex flex-wrap gap-2" action="/expirations">
        <select name="propertyId" defaultValue={propertyId ?? ""} className="rounded-lg border border-border px-3 py-1.5 text-sm">
          <option value="">All stores</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">
          Filter
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing is being counted down yet"
          description="Open a piece of equipment, such as a fire extinguisher, and photograph its tag. The date is read and remembered."
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">What</th>
                    <th className="px-3 py-2.5 font-medium">Store</th>
                    <th className="px-3 py-2.5 font-medium">Expires</th>
                    <th className="px-3 py-2.5 font-medium">Who to call</th>
                    {canManage ? <th className="px-5 py-2.5 font-medium" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const vendor = i.asset?.serviceVendor;
                    return (
                      <tr key={i.id} className="border-b border-border align-top last:border-0">
                        <td className="px-5 py-3">
                          <p className="font-medium text-foreground">{i.kind}</p>
                          <p className="text-xs text-muted">
                            {i.asset ? (
                              <Link href={`/assets/${i.asset.id}`} className="hover:text-brand">
                                {i.asset.name}
                              </Link>
                            ) : null}
                            {i.asset && i.label ? " · " : ""}
                            {i.label}
                          </p>
                          {i.needsReview ? (
                            <p className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                              Read by AI from a photo. Check the date.
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <Link href={`/properties/${i.property.id}`} className="text-muted hover:text-brand">
                            {i.property.name}
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <p className="tabular-nums">{isoDay(i.expiresAt)}</p>
                          <CountdownBadge daysLeft={i.daysLeft} />
                        </td>
                        <td className="px-3 py-3">
                          {vendor ? (
                            <div className="text-sm">
                              <Link href={`/contractors/${vendor.id}`} className="font-medium text-foreground hover:text-brand">
                                {vendor.name}
                              </Link>
                              {vendor.contactPhone ? <p><PhoneLink number={vendor.contactPhone} /></p> : null}
                              {vendor.emergencyPhone ? <p><PhoneLink number={vendor.emergencyPhone} label="After hours " /></p> : null}
                            </div>
                          ) : (
                            <span className="text-xs text-muted">No contractor set</span>
                          )}
                        </td>
                        {canManage ? (
                          <td className="px-5 py-3">
                            <ExpiryRowActions id={i.id} kind={i.kind} needsReview={i.needsReview} expiresOn={isoDay(i.expiresAt)} />
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
