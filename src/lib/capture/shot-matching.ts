import { distanceMeters } from "@/lib/media/panorama-metadata";

/**
 * Works out which shot position on a capture route each photo was taken at.
 *
 * Pure and dependency-free so the same decision runs in the browser, where
 * the importer proposes a position for every file before anything is
 * uploaded, and in tests.
 *
 * Two signals, in order of trust:
 *
 *  1. GPS. A geotagged photo goes to the nearest pinned position within
 *     GPS_MATCH_RADIUS_METERS. Phone-assisted GPS on a 360 camera is good to
 *     roughly 5–15 m, so the radius allows for that and no more; a photo
 *     further than that from every pin was taken somewhere that is not on
 *     the route, and is left unassigned rather than forced onto one.
 *
 *  2. Walking order. A route is walked in sequence, and 360 cameras number
 *     their files by time. When the photos left over are exactly as many as
 *     the positions left over, they are paired in order. When the counts
 *     differ — a skipped position, a retake — there is no safe pairing, and
 *     every leftover photo is left for a person to choose. A wrong position
 *     is worse than an empty one: it breaks the time series the route exists
 *     to build, and nobody notices.
 *
 * Nothing here is final. The importer shows each proposal and lets the
 * person change it before uploading.
 */

/** How close a geotagged photo must be to a pin to be matched to it. */
export const GPS_MATCH_RADIUS_METERS = 30;

export interface ShotTarget {
  id: string;
  label: string;
  sequence: number;
  latitude: number | null;
  longitude: number | null;
  /** Already has a photo from an earlier upload. */
  captured: boolean;
}

export interface PhotoToMatch {
  /** Any stable identifier for the photo within this batch. */
  key: string;
  filename: string;
  latitude: number | null;
  longitude: number | null;
  capturedAt: Date | null;
}

export type ShotMatch =
  | { shotId: string; method: "GPS"; distanceMeters: number }
  | { shotId: string; method: "ORDER" }
  | { shotId: null; method: null; reason: string };

function hasPoint(p: { latitude: number | null; longitude: number | null }): p is { latitude: number; longitude: number } {
  return p.latitude !== null && p.longitude !== null;
}

/** Shooting order: capture time, then filename (Insta360 names files by time). */
function byShootingOrder(a: PhotoToMatch, b: PhotoToMatch): number {
  const at = a.capturedAt?.getTime();
  const bt = b.capturedAt?.getTime();
  if (at !== undefined && bt !== undefined && at !== bt) return at - bt;
  if (at !== undefined && bt === undefined) return -1;
  if (at === undefined && bt !== undefined) return 1;
  return a.filename.localeCompare(b.filename, undefined, { numeric: true });
}

export function matchPhotosToShots(photos: PhotoToMatch[], shots: ShotTarget[]): Map<string, ShotMatch> {
  const result = new Map<string, ShotMatch>();
  if (shots.length === 0) {
    for (const p of photos) result.set(p.key, { shotId: null, method: null, reason: "This site has no route" });
    return result;
  }

  const pinned = shots.filter(hasPoint);
  const unpinnedCount = shots.length - pinned.length;
  const claimed = new Set<string>();
  const leftover: PhotoToMatch[] = [];

  // 1. GPS.
  for (const photo of photos) {
    if (!hasPoint(photo) || pinned.length === 0) {
      leftover.push(photo);
      continue;
    }
    let best: { shot: ShotTarget; d: number } | null = null;
    for (const shot of pinned) {
      const d = distanceMeters(photo.latitude, photo.longitude, shot.latitude!, shot.longitude!);
      if (!best || d < best.d) best = { shot, d };
    }
    if (best && best.d <= GPS_MATCH_RADIUS_METERS) {
      result.set(photo.key, { shotId: best.shot.id, method: "GPS", distanceMeters: best.d });
      claimed.add(best.shot.id);
    } else if (unpinnedCount > 0) {
      // Not near any pin, but there are positions without one: it may be one of those.
      leftover.push(photo);
    } else {
      result.set(photo.key, {
        shotId: null,
        method: null,
        reason: `Not within ${GPS_MATCH_RADIUS_METERS} m of any position on the route`,
      });
    }
  }

  if (leftover.length === 0) return result;

  // 2. Walking order, over what neither GPS nor an earlier upload has covered.
  const openShots = shots.filter((s) => !s.captured && !claimed.has(s.id)).sort((a, b) => a.sequence - b.sequence);
  const ordered = [...leftover].sort(byShootingOrder);

  const unassigned = (reason: string) => {
    for (const p of leftover) result.set(p.key, { shotId: null, method: null, reason });
  };

  if (openShots.length === 0) {
    unassigned("Every position on the route already has a photo");
    return result;
  }
  if (ordered.length !== openShots.length) {
    unassigned(
      `${ordered.length} ${ordered.length === 1 ? "photo" : "photos"} for ${openShots.length} remaining ${
        openShots.length === 1 ? "position" : "positions"
      } — choose each one`,
    );
    return result;
  }

  // A pairing that puts a geotagged photo on a pin it is far from is
  // contradicted by the GPS, which means the order assumption is wrong.
  // Then none of the pairing can be trusted.
  for (let i = 0; i < ordered.length; i++) {
    const photo = ordered[i];
    const shot = openShots[i];
    if (hasPoint(photo) && hasPoint(shot)) {
      if (distanceMeters(photo.latitude, photo.longitude, shot.latitude, shot.longitude) > GPS_MATCH_RADIUS_METERS) {
        unassigned("Shooting order doesn't line up with the route — choose each one");
        return result;
      }
    }
  }

  ordered.forEach((photo, i) => result.set(photo.key, { shotId: openShots[i].id, method: "ORDER" }));
  return result;
}

/**
 * Reads "latitude, longitude" as typed or pasted — Google Maps copies exactly
 * this when you right-click a spot. Empty means "no pin"; anything else that
 * is not a valid pair is "invalid", so a typo is flagged rather than saved.
 */
export function parseLatLng(text: string): { latitude: number; longitude: number } | null | "invalid" {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*\)?$/);
  if (!m) return "invalid";
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return "invalid";
  return { latitude, longitude };
}
