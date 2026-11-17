/**
 * Rules for points and areas of interest drawn on the site map. Pure, so the
 * map and the server agree and the rules are testable.
 */

export const MAX_AREA_VERTICES = 200;

export type LngLat = [number, number];

export function isLngLat(value: unknown): value is LngLat {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

export function pointProblem(latitude: number, longitude: number): string | null {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return "Latitude must be between -90 and 90";
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return "Longitude must be between -180 and 180";
  return null;
}

/**
 * An area is an open ring of at least three distinct corners. A ring sent
 * closed (last corner repeating the first) is accepted and opened, since
 * GeoJSON tools write it that way.
 */
export function normaliseArea(ring: unknown): { ring: LngLat[] } | { problem: string } {
  if (!Array.isArray(ring) || !ring.every(isLngLat)) return { problem: "Every corner must be a [longitude, latitude] pair" };
  const corners = [...ring] as LngLat[];
  const first = corners[0];
  const last = corners[corners.length - 1];
  if (corners.length > 1 && first[0] === last[0] && first[1] === last[1]) corners.pop();
  const distinct = new Set(corners.map(([lng, lat]) => `${lng},${lat}`));
  if (distinct.size < 3) return { problem: "An area needs at least three corners" };
  if (corners.length > MAX_AREA_VERTICES) return { problem: `An area can have at most ${MAX_AREA_VERTICES} corners` };
  return { ring: corners };
}

/** A #rrggbb colour, or null when it is not one. */
export function normaliseColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : null;
}

/** The middle of a ring's bounding box: where an area's label pin goes. */
export function ringCentre(ring: LngLat[]): LngLat {
  const lngs = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}
