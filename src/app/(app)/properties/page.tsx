import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { getLatestHealthSnapshots } from "@/lib/scoring";
import { healthBandFor } from "@/lib/scoring-categories";
import { Card, CardBody } from "@/components/ui/Card";
import { HealthBandBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCents } from "@/lib/format";

const BANDS = ["Excellent", "Good", "Needs Attention", "Poor", "Critical"];

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ healthBand?: string; search?: string; status?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const params = await searchParams;

  const properties = await prisma.property.findMany({
    where: {
      AND: [
        propertyScopeWhere(ctx),
        params.search
          ? {
              OR: [
                { name: { contains: params.search, mode: "insensitive" } },
                { city: { contains: params.search, mode: "insensitive" } },
                { customerPropertyId: { contains: params.search, mode: "insensitive" } },
              ],
            }
          : {},
        params.status ? { status: params.status as never } : {},
      ],
    },
    orderBy: { name: "asc" },
    include: { region: { select: { name: true } } },
  });

  const snapshots = await getLatestHealthSnapshots(properties.map((p) => p.id));
  const snapByProperty = new Map(snapshots.map((s) => [s.propertyId, s]));

  let rows = properties.map((p) => {
    const snap = snapByProperty.get(p.id);
    return { property: p, health: snap ?? null, band: snap ? healthBandFor(snap.healthScore) : null };
  });

  if (params.healthBand) {
    rows = rows.filter((r) => r.band === params.healthBand);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Properties</h1>
          <p className="text-sm text-muted">{rows.length} of {properties.length} properties</p>
        </div>
      </div>

      <form className="flex flex-wrap gap-2" action="/properties">
        <input
          name="search"
          defaultValue={params.search}
          placeholder="Search name, city, or property ID..."
          className="w-64 rounded-lg border border-border px-3 py-1.5 text-sm outline-none focus:border-brand"
        />
        <select name="healthBand" defaultValue={params.healthBand ?? ""} className="rounded-lg border border-border px-3 py-1.5 text-sm">
          <option value="">All conditions</option>
          {BANDS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={params.status ?? ""} className="rounded-lg border border-border px-3 py-1.5 text-sm">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="UNDER_DEVELOPMENT">Under development</option>
          <option value="DIVESTED">Divested</option>
        </select>
        <button type="submit" className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No properties match" description="Try clearing filters, or import/create properties to get started." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Property</th>
                  <th className="px-3 py-2.5 font-medium">Region</th>
                  <th className="px-3 py-2.5 font-medium">Health</th>
                  <th className="px-3 py-2.5 font-medium">Risk</th>
                  <th className="px-3 py-2.5 font-medium">Condition</th>
                  <th className="px-5 py-2.5 text-right font-medium">CapEx (12mo)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ property, health, band }) => (
                  <tr key={property.id} className="border-b border-border last:border-0 hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <Link href={`/properties/${property.id}`} className="font-medium text-foreground hover:text-brand">
                        {property.name}
                      </Link>
                      <p className="text-xs text-muted">
                        {property.city}, {property.state}
                        {property.customerPropertyId ? ` · ${property.customerPropertyId}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-muted">{property.region?.name ?? "—"}</td>
                    <td className="px-3 py-3 tabular-nums">{health?.healthScore ?? "—"}</td>
                    <td className="px-3 py-3 tabular-nums">{health?.riskScore ?? "—"}</td>
                    <td className="px-3 py-3">{band ? <HealthBandBadge band={band} /> : <span className="text-xs text-muted">No data</span>}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{health ? formatCents(health.capitalExposure12mo) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
