import { redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { getLatestHealthSnapshots } from "@/lib/scoring";
import { healthBandFor } from "@/lib/scoring-categories";
import { EmptyState } from "@/components/ui/EmptyState";
import { PortfolioMap } from "@/components/map/PortfolioMap";

export default async function MapPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const properties = await prisma.property.findMany({
    where: { AND: [propertyScopeWhere(ctx), { latitude: { not: null } }, { longitude: { not: null } }] },
    select: { id: true, name: true, latitude: true, longitude: true },
  });
  const snapshots = await getLatestHealthSnapshots(properties.map((p) => p.id));
  const snapByProperty = new Map(snapshots.map((s) => [s.propertyId, s]));

  const points = properties
    .filter((p): p is typeof p & { latitude: number; longitude: number } => p.latitude !== null && p.longitude !== null)
    .map((p) => {
      const snap = snapByProperty.get(p.id);
      return {
        id: p.id,
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        healthScore: snap?.healthScore ?? null,
        band: snap ? healthBandFor(snap.healthScore) : null,
      };
    });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Portfolio Map</h1>
        <p className="text-sm text-muted">{points.length} properties with coordinates · pin color = health band</p>
      </div>

      {points.length === 0 ? (
        <EmptyState title="No properties with coordinates yet" description="Add latitude/longitude to properties to see them on the map." />
      ) : !token ? (
        <div className="space-y-3">
          <EmptyState
            title="Mapbox is not configured"
            description="Set NEXT_PUBLIC_MAPBOX_TOKEN to enable the interactive map. Showing a plain list instead — real Mapbox integration code is in place, it just needs a token."
          />
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {points.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="font-medium text-foreground">{p.name}</span>
                <span className="text-muted">
                  {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)} · {p.band ?? "no data"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <PortfolioMap properties={points} token={token} />
      )}
    </div>
  );
}
