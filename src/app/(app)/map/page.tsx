import { redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { getLatestHealthSnapshots } from "@/lib/scoring";
import { healthBandFor } from "@/lib/scoring-categories";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExploreMap } from "@/components/map/ExploreMap";
import { recordProductEvent } from "@/lib/analytics";

export default async function MapPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // Product analytics (§105). `configured` records whether the map could
  // actually render: without a Mapbox token the page degrades to a list, and
  // counting that as map adoption would report a feature as popular in an
  // environment where it does not work. Awaited but never able to throw, and
  // flagged automatically when the viewer is support impersonating.
  await recordProductEvent(ctx, "map.viewed", { configured: !!token });

  const properties = await prisma.property.findMany({
    where: { AND: [propertyScopeWhere(ctx), { latitude: { not: null } }, { longitude: { not: null } }] },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
      propertyType: true,
      region: { select: { name: true } },
    },
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
        addressLine1: p.addressLine1,
        city: p.city,
        state: p.state,
        postalCode: p.postalCode,
        propertyType: p.propertyType,
        regionName: p.region?.name ?? null,
        healthScore: snap?.healthScore ?? null,
        band: snap ? healthBandFor(snap.healthScore) : null,
      };
    });

  // The map is the page. `-m-6` cancels the app shell's padding so the canvas
  // runs edge to edge, and the height subtracts only the 3.5rem header — the
  // impersonation banner, when present, is allowed to push the map down rather
  // than overlap it.
  if (points.length === 0 || !token) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Explore</h1>
          <p className="text-sm text-muted">{points.length} locations with coordinates</p>
        </div>
        {points.length === 0 ? (
          <EmptyState
            title="No locations with coordinates yet"
            description="Add latitude/longitude to properties to see them on the map."
          />
        ) : (
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
                    {p.city}, {p.state} · {p.band ?? "no data"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="-m-6 h-[calc(100vh-3.5rem)]">
      <ExploreMap properties={points} token={token} />
    </div>
  );
}
