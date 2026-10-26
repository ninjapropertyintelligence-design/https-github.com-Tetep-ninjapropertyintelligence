import { distanceMeters } from "@/lib/media/panorama-metadata";

/**
 * Walking between 360 panoramas, Street View style: from where one was shot,
 * arrows on the ground point at the others nearby. Pure, so it is testable
 * and the same on every page that shows panoramas.
 *
 * Placing an arrow needs two angles: the compass bearing from this panorama
 * to the next (from GPS), and which way this panorama's image faces (its
 * heading: the compass direction of the image's centre). The heading comes
 * from the camera when it recorded one, from a person who set it, or failing
 * both is estimated from the direction of travel, since a handheld 360 camera
 * is usually carried facing the way the person walks.
 */

export interface NavPanorama {
  id: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  /** Recorded or set heading, degrees clockwise from north. Null when unknown. */
  heading: number | null;
  /** ISO capture time, for ordering a walk. */
  capturedAt: string | null;
}

export interface PanoramaLink {
  id: string;
  label: string;
  /** Compass bearing from this panorama to that one. */
  bearing: number;
  distance: number;
}

/** Panoramas further apart than this are not one walk. */
export const MAX_LINK_METERS = 40;
/** Two neighbours this close in direction get one arrow: the nearer. */
const MIN_ARROW_SEPARATION = 25;
const MAX_ARROWS = 6;

export function normaliseDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

/** Initial great-circle bearing from A to B, degrees clockwise from north. */
export function bearingDegrees(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const φ1 = aLat * rad;
  const φ2 = bLat * rad;
  const Δλ = (bLng - aLng) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normaliseDegrees(Math.atan2(y, x) / rad);
}

function angleBetween(a: number, b: number): number {
  const d = Math.abs(normaliseDegrees(a) - normaliseDegrees(b));
  return d > 180 ? 360 - d : d;
}

const located = (p: NavPanorama): p is NavPanorama & { latitude: number; longitude: number } =>
  p.latitude !== null && p.longitude !== null;

/**
 * Every panorama's heading: its own when known, otherwise the direction of
 * travel through it (from the previous shot, or towards the next for the
 * first one). Null when it has no neighbour in time to estimate from.
 */
export function effectiveHeadings(panoramas: NavPanorama[]): Map<string, { heading: number; estimated: boolean } | null> {
  const ordered = panoramas
    .filter(located)
    .slice()
    .sort((a, b) => (a.capturedAt ?? "").localeCompare(b.capturedAt ?? ""));
  const result = new Map<string, { heading: number; estimated: boolean } | null>();
  for (const p of panoramas) result.set(p.id, p.heading !== null ? { heading: normaliseDegrees(p.heading), estimated: false } : null);
  ordered.forEach((p, index) => {
    if (p.heading !== null) return;
    const before = ordered[index - 1];
    const after = ordered[index + 1];
    const usable = (q: typeof p | undefined) => q && distanceMeters(p.latitude, p.longitude, q.latitude, q.longitude) > 0.5;
    if (usable(before)) {
      result.set(p.id, { heading: bearingDegrees(before!.latitude, before!.longitude, p.latitude, p.longitude), estimated: true });
    } else if (usable(after)) {
      result.set(p.id, { heading: bearingDegrees(p.latitude, p.longitude, after!.latitude, after!.longitude), estimated: true });
    }
  });
  return result;
}

/**
 * The arrows to draw from one panorama: neighbours within walking distance,
 * one per direction (the nearest), at most a handful so the ground stays
 * readable.
 */
export function panoramaLinks(current: NavPanorama, all: NavPanorama[]): PanoramaLink[] {
  if (!located(current)) return [];
  const candidates = all
    .filter((p): p is NavPanorama & { latitude: number; longitude: number } => p.id !== current.id && located(p))
    .map((p) => ({
      id: p.id,
      label: p.label,
      bearing: bearingDegrees(current.latitude, current.longitude, p.latitude, p.longitude),
      distance: distanceMeters(current.latitude, current.longitude, p.latitude, p.longitude),
    }))
    .filter((l) => l.distance > 0.5 && l.distance <= MAX_LINK_METERS)
    .sort((a, b) => a.distance - b.distance);
  const chosen: PanoramaLink[] = [];
  for (const link of candidates) {
    if (chosen.some((c) => angleBetween(c.bearing, link.bearing) < MIN_ARROW_SEPARATION)) continue;
    chosen.push(link);
    if (chosen.length === MAX_ARROWS) break;
  }
  return chosen;
}
