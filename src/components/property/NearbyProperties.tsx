import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { findNearestProperties, metersToMiles } from "@/lib/spatial";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Properties nearest to this one (spec §11).
 *
 * Useful in its own right — clustered sites share crews, vendors and
 * weather events — and it is the visible proof that the spatial index is
 * doing something, since the ordering here is computed by PostGIS rather
 * than in JavaScript.
 *
 * Renders nothing when the property has no coordinates. That is a real
 * state, not an error: geocoding degrades honestly when no Mapbox token is
 * configured, so properties can legitimately have no location.
 */
export async function NearbyProperties({
  ctx,
  propertyId,
  latitude,
  longitude,
}: {
  ctx: SessionContext;
  propertyId: string;
  latitude: number | null;
  longitude: number | null;
}) {
  if (latitude === null || longitude === null) {
    return (
      <Card>
        <CardHeader title="Nearby properties" />
        <CardBody className="text-sm text-muted">
          This property has no coordinates, so nearby sites cannot be calculated. Adding an address
          that geocodes, or coordinates directly, will populate this.
        </CardBody>
      </Card>
    );
  }

  // Asks for one extra: the nearest result is always this property itself,
  // at distance zero, and it is filtered out below.
  const { properties } = await findNearestProperties(ctx, { latitude, longitude, limit: 6 });
  const others = properties.filter((p) => p.id !== propertyId).slice(0, 5);

  return (
    <Card>
      <CardHeader title="Nearby properties" subtitle="Closest sites in your portfolio, by road-less straight-line distance." />
      <CardBody className="p-0">
        {others.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">
            No other located properties in your portfolio.
          </p>
        ) : (
          <ul>
            {others.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between border-b border-border px-5 py-2.5 text-sm last:border-0"
              >
                <Link href={`/properties/${p.id}`} className="font-medium text-brand hover:underline">
                  {p.name}
                </Link>
                <span className="text-xs text-muted">
                  {p.distanceMeters === null
                    ? "—"
                    : `${metersToMiles(p.distanceMeters).toFixed(1)} mi`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
