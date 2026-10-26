/**
 * Checks for map overlays, kept pure so they can be tested without storage.
 *
 * A bad overlay fails late and quietly otherwise: Mapbox draws an image with
 * swapped edges inside out, and a malformed GeoJSON file just renders
 * nothing, so the person who uploaded it sees an empty map and no reason.
 */

export const RASTER_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Plan sheets and aerials comfortably fit; a full orthomosaic belongs in a drone capture, not here. */
export const MAX_RASTER_BYTES = 40 * 1024 * 1024;
/** GeoJSON is parsed on the server and drawn in the browser; past this it is the wrong tool. */
export const MAX_VECTOR_BYTES = 5 * 1024 * 1024;

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** Returns what is wrong with a raster's edges, or null when they are usable. */
export function boundsProblem(b: Partial<Bounds>): string | null {
  const { north, south, east, west } = b;
  if ([north, south, east, west].some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    return "A raster overlay needs north, south, east and west edges";
  }
  if (north! > 90 || south! < -90) return "Latitude edges must be between -90 and 90";
  if (east! > 180 || west! < -180) return "Longitude edges must be between -180 and 180";
  if (north! <= south!) return "The north edge must be north of the south edge";
  // An overlay across the antimeridian would need east < west; no property
  // site is that wide, so treat it as the swapped-edges mistake it almost
  // certainly is.
  if (east! <= west!) return "The east edge must be east of the west edge";
  // A site plan, not a continent. Half a degree is ~55 km.
  if (north! - south! > 0.5 || east! - west! > 0.5) return "Those edges cover far more than one site — check the coordinates";
  return null;
}

/** Corners in the order Mapbox's image source wants: top-left, top-right, bottom-right, bottom-left. */
export function boundsToCorners(b: Bounds): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [b.west, b.north],
    [b.east, b.north],
    [b.east, b.south],
    [b.west, b.south],
  ];
}

const GEOMETRY_TYPES = new Set(["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"]);

/**
 * Parses a GeoJSON file and returns its feature count, or a problem.
 *
 * Structural only: the top-level shape and each geometry's type. Coordinates
 * are not re-projected — GeoJSON is WGS84 by definition (RFC 7946), and a
 * file exported in a local CRS will land in the wrong place, which the map
 * makes obvious in a way a validator cannot.
 */
export function parseGeoJson(text: string): { ok: true; features: number } | { ok: false; problem: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, problem: "The file is not valid JSON" };
  }
  if (!doc || typeof doc !== "object") return { ok: false, problem: "The file is not a GeoJSON object" };
  const obj = doc as { type?: unknown; features?: unknown; geometry?: unknown };

  const geometryOk = (g: unknown) =>
    !!g && typeof g === "object" && GEOMETRY_TYPES.has(String((g as { type?: unknown }).type));

  if (obj.type === "FeatureCollection") {
    if (!Array.isArray(obj.features)) return { ok: false, problem: "A FeatureCollection needs a features array" };
    const bad = obj.features.findIndex(
      (f) => !f || typeof f !== "object" || (f as { type?: unknown }).type !== "Feature" || !geometryOk((f as { geometry?: unknown }).geometry),
    );
    if (bad >= 0) return { ok: false, problem: `Feature ${bad + 1} has no recognisable geometry` };
    return { ok: true, features: obj.features.length };
  }
  if (obj.type === "Feature") {
    return geometryOk(obj.geometry) ? { ok: true, features: 1 } : { ok: false, problem: "The feature has no recognisable geometry" };
  }
  if (GEOMETRY_TYPES.has(String(obj.type))) return { ok: true, features: 1 };
  return { ok: false, problem: "The file is not GeoJSON (expected a FeatureCollection, Feature or geometry)" };
}

export const OVERLAY_CATEGORY_LABELS: Record<string, string> = {
  AERIAL: "Aerial",
  SITE_PLAN: "Site plan",
  FLOOR_PLAN: "Floor plan",
  FFE_PLAN: "FF&E plan",
  REFLECTED_CEILING_PLAN: "Ceiling plan (RCP)",
  ROOF_PLAN: "Roof plan",
  OTHER: "Other",
};
