/**
 * Placing a drone map on the world map, and measuring on it.
 *
 * A GeoTIFF records where it is in its own coordinate system. DroneDeploy
 * and most photogrammetry tools write one of three: plain latitude/longitude
 * (EPSG:4326), Web Mercator (EPSG:3857), or the local UTM zone
 * (EPSG:326xx north / 327xx south). Those three are converted here without a
 * projection library; anything else is reported as unplaceable rather than
 * guessed, because a map drawn a block away from its building is worse than
 * one shown flat.
 */

export type LngLat = [number, number];

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const E2 = WGS84_F * (2 - WGS84_F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;

export function isSupportedEpsg(epsg: number | null | undefined): boolean {
  if (!epsg) return false;
  return epsg === 4326 || epsg === 3857 || epsg === 900913 || utmZone(epsg) !== null;
}

function utmZone(epsg: number): { zone: number; south: boolean } | null {
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, south: false };
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, south: true };
  return null;
}

/** A point in the GeoTIFF's coordinate system, as longitude/latitude. Null if the system is not supported. */
export function toLngLat(x: number, y: number, epsg: number): LngLat | null {
  if (epsg === 4326) return [x, y];
  if (epsg === 3857 || epsg === 900913) {
    const lng = (x / WGS84_A) * (180 / Math.PI);
    const lat = (2 * Math.atan(Math.exp(y / WGS84_A)) - Math.PI / 2) * (180 / Math.PI);
    return [lng, lat];
  }
  const utm = utmZone(epsg);
  if (utm) return utmToLngLat(x, y, utm.zone, utm.south);
  return null;
}

/** Inverse transverse Mercator on WGS84 (Snyder, "Map Projections — A Working Manual", 1987). */
export function utmToLngLat(easting: number, northing: number, zone: number, south: boolean): LngLat {
  const x = easting - 500000;
  const y = south ? northing - 10000000 : northing;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);

  const m = y / K0;
  const mu = m / (WGS84_A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const c1 = EP2 * cos1 ** 2;
  const t1 = tan1 ** 2;
  const n1 = WGS84_A / Math.sqrt(1 - E2 * sin1 ** 2);
  const r1 = (WGS84_A * (1 - E2)) / (1 - E2 * sin1 ** 2) ** 1.5;
  const d = x / (n1 * K0);

  const lat =
    phi1 -
    ((n1 * tan1) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * EP2 - 3 * c1 ** 2) * d ** 6) / 720);
  const lon =
    lon0 +
    (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * EP2 + 24 * t1 ** 2) * d ** 5) / 120) /
      cos1;

  return [lon * (180 / Math.PI), lat * (180 / Math.PI)];
}

/** Forward transverse Mercator, the counterpart of `utmToLngLat` (used to check it). */
export function lngLatToUtm(lng: number, lat: number, zone: number): { easting: number; northing: number } {
  const phi = (lat * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const lam0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const n = WGS84_A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2;
  const c = EP2 * Math.cos(phi) ** 2;
  const a = Math.cos(phi) * (lam - lam0);
  const m =
    WGS84_A *
    ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));
  const easting =
    K0 * n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t ** 2 + 72 * c - 58 * EP2) * a ** 5) / 120) + 500000;
  let northing =
    K0 *
    (m +
      n *
        Math.tan(phi) *
        (a ** 2 / 2 +
          ((5 - t + 9 * c + 4 * c ** 2) * a ** 4) / 24 +
          ((61 - 58 * t + t ** 2 + 600 * c - 330 * EP2) * a ** 6) / 720));
  if (lat < 0) northing += 10000000;
  return { easting, northing };
}

/**
 * The four corners of an image, top-left first and clockwise — the order a
 * Mapbox image source takes. Each corner is converted on its own, so a map in
 * UTM keeps the slight rotation it has against north rather than being
 * squared off. Null when the coordinate system is not supported or the
 * result is not a plausible place on Earth.
 */
export function cornersFromBBox(
  bbox: [number, number, number, number],
  epsg: number,
): [LngLat, LngLat, LngLat, LngLat] | null {
  const [minX, minY, maxX, maxY] = bbox;
  const corners = [
    toLngLat(minX, maxY, epsg),
    toLngLat(maxX, maxY, epsg),
    toLngLat(maxX, minY, epsg),
    toLngLat(minX, minY, epsg),
  ];
  if (corners.some((c) => c === null)) return null;
  const valid = corners.every(
    (c) => Number.isFinite(c![0]) && Number.isFinite(c![1]) && Math.abs(c![0]) <= 180 && Math.abs(c![1]) <= 85,
  );
  return valid ? (corners as [LngLat, LngLat, LngLat, LngLat]) : null;
}

const MEAN_EARTH_RADIUS = 6371008.8;

/** Great-circle distance in metres. */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * MEAN_EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a path in metres. */
export function pathLengthMeters(points: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i]);
  return total;
}

/**
 * Area of a polygon in square metres, on the sphere (Chamberlain & Duquette,
 * "Some Algorithms for Polygons on a Sphere", 2007 — the method Turf uses).
 */
export function polygonAreaSquareMeters(ring: LngLat[]): number {
  if (ring.length < 3) return 0;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    total += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((total * WGS84_A * WGS84_A) / 2);
}

export function formatLength(meters: number): string {
  const feet = meters * 3.28084;
  return feet >= 5280 ? `${(feet / 5280).toFixed(2)} mi (${(meters / 1000).toFixed(2)} km)` : `${Math.round(feet).toLocaleString()} ft (${meters.toFixed(1)} m)`;
}

export function formatArea(squareMeters: number): string {
  const sqft = squareMeters * 10.7639;
  const acres = squareMeters / 4046.8564224;
  return acres >= 1
    ? `${acres.toFixed(2)} acres (${Math.round(sqft).toLocaleString()} sq ft)`
    : `${Math.round(sqft).toLocaleString()} sq ft (${Math.round(squareMeters).toLocaleString()} m²)`;
}
