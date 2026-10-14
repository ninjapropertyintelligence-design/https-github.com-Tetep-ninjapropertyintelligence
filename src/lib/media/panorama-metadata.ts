/**
 * Reads what a 360 camera writes into a JPEG: capture time, GPS, dimensions,
 * camera make/model, and the XMP "GPano" projection tag.
 *
 * Pure byte parsing with no dependencies, so the same code runs in the
 * browser (where the Insta360 importer reads files straight off an SD card
 * before uploading anything) and in tests. Only the head of a file is needed:
 * EXIF, XMP and the frame header all come before the image data.
 *
 * Scope is deliberately narrow — the handful of tags auto-import uses — and
 * every read is bounds-checked, because the input is whatever file a person
 * dropped and a malformed one must produce "unknown", never an exception.
 */

export interface PanoramaMetadata {
  width: number | null;
  height: number | null;
  capturedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  make: string | null;
  model: string | null;
  /** From XMP `GPano:ProjectionType`, lower-cased, e.g. "equirectangular". */
  projection: string | null;
}

const EMPTY: PanoramaMetadata = {
  width: null,
  height: null,
  capturedAt: null,
  latitude: null,
  longitude: null,
  make: null,
  model: null,
  projection: null,
};

/** How much of the file the importer reads. Generous: some cameras embed a large preview in APP segments. */
export const METADATA_HEAD_BYTES = 1024 * 1024;

export function readPanoramaMetadata(bytes: Uint8Array): PanoramaMetadata {
  const meta: PanoramaMetadata = { ...EMPTY };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return meta;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    // Fill bytes and standalone markers carry no length.
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end: no more headers
    const length = view.getUint16(offset + 2);
    if (length < 2) break;
    const start = offset + 4;
    const end = Math.min(offset + 2 + length, bytes.length);

    if (marker === 0xe1) {
      const segment = bytes.subarray(start, end);
      if (startsWithAscii(segment, "Exif\0\0")) {
        readExif(segment.subarray(6), meta);
      } else if (startsWithAscii(segment, "http://ns.adobe.com/xap/1.0/\0")) {
        readXmp(segment.subarray(29), meta);
      }
    } else if (isStartOfFrame(marker) && end - start >= 5) {
      meta.height = view.getUint16(start + 1);
      meta.width = view.getUint16(start + 3);
    }
    offset += 2 + length;
  }
  return meta;
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function startsWithAscii(bytes: Uint8Array, text: string): boolean {
  if (bytes.length < text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[i] !== text.charCodeAt(i)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// EXIF (TIFF structure)
// ---------------------------------------------------------------------------

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Offset of the value within the TIFF block (inline or pointed-to). */
  valueOffset: number;
}

function readExif(tiff: Uint8Array, meta: PanoramaMetadata) {
  if (tiff.length < 8) return;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const order = String.fromCharCode(tiff[0], tiff[1]);
  if (order !== "II" && order !== "MM") return;
  const le = order === "II";
  if (view.getUint16(2, le) !== 42) return;

  const ifd0 = readIfd(view, view.getUint32(4, le), le);
  meta.make = readAscii(tiff, ifd0.get(0x010f)) ?? meta.make;
  meta.model = readAscii(tiff, ifd0.get(0x0110)) ?? meta.model;

  const exifPointer = ifd0.get(0x8769);
  if (exifPointer) {
    const exif = readIfd(view, readUint(view, exifPointer, le), le);
    const original = readAscii(tiff, exif.get(0x9003)) ?? readAscii(tiff, ifd0.get(0x0132));
    const offsetTime = readAscii(tiff, exif.get(0x9011));
    meta.capturedAt = parseExifDate(original, offsetTime);
  }

  const gpsPointer = ifd0.get(0x8825);
  if (gpsPointer) {
    const gps = readIfd(view, readUint(view, gpsPointer, le), le);
    const lat = readDegrees(view, gps.get(0x0002), le);
    const lng = readDegrees(view, gps.get(0x0004), le);
    const latRef = readAscii(tiff, gps.get(0x0001));
    const lngRef = readAscii(tiff, gps.get(0x0003));
    if (lat !== null && lng !== null && !(lat === 0 && lng === 0)) {
      const signedLat = latRef?.toUpperCase() === "S" ? -lat : lat;
      const signedLng = lngRef?.toUpperCase() === "W" ? -lng : lng;
      if (Math.abs(signedLat) <= 90 && Math.abs(signedLng) <= 180) {
        meta.latitude = signedLat;
        meta.longitude = signedLng;
      }
    }
  }
}

function readIfd(view: DataView, offset: number, le: boolean): Map<number, Entry> {
  const entries = new Map<number, Entry>();
  if (offset <= 0 || offset + 2 > view.byteLength) return entries;
  const count = view.getUint16(offset, le);
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    if (at + 12 > view.byteLength) break;
    const tag = view.getUint16(at, le);
    const type = view.getUint16(at + 2, le);
    const n = view.getUint32(at + 4, le);
    const size = (TYPE_SIZES[type] ?? 1) * n;
    const valueOffset = size <= 4 ? at + 8 : view.getUint32(at + 8, le);
    entries.set(tag, { tag, type, count: n, valueOffset });
  }
  return entries;
}

function readUint(view: DataView, entry: Entry, le: boolean): number {
  if (entry.valueOffset + 4 > view.byteLength) return 0;
  return entry.type === 3 ? view.getUint16(entry.valueOffset, le) : view.getUint32(entry.valueOffset, le);
}

function readAscii(tiff: Uint8Array, entry: Entry | undefined): string | null {
  if (!entry || entry.type !== 2) return null;
  const end = Math.min(entry.valueOffset + entry.count, tiff.length);
  if (entry.valueOffset >= end) return null;
  let text = "";
  for (let i = entry.valueOffset; i < end; i++) {
    if (tiff[i] === 0) break;
    text += String.fromCharCode(tiff[i]);
  }
  text = text.trim();
  return text.length > 0 ? text : null;
}

/** Degrees/minutes/seconds as three RATIONALs -> decimal degrees. */
function readDegrees(view: DataView, entry: Entry | undefined, le: boolean): number | null {
  if (!entry || entry.type !== 5 || entry.count < 3) return null;
  if (entry.valueOffset + 24 > view.byteLength) return null;
  const parts: number[] = [];
  for (let i = 0; i < 3; i++) {
    const num = view.getUint32(entry.valueOffset + i * 8, le);
    const den = view.getUint32(entry.valueOffset + i * 8 + 4, le);
    if (den === 0) return null;
    parts.push(num / den);
  }
  return parts[0] + parts[1] / 60 + parts[2] / 3600;
}

/**
 * EXIF dates are "YYYY:MM:DD HH:MM:SS" with no zone. When the camera also
 * wrote OffsetTimeOriginal ("+02:00") the instant is exact; without it the
 * clock time is read as the importer's local time, which is right in the
 * common case of the person importing being where the camera was set.
 */
export function parseExifDate(value: string | null, offset: string | null): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (y === "0000") return null;
  const zone = offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : null;
  const date = zone
    ? new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`)
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------------------------------------------------------------------------
// XMP
// ---------------------------------------------------------------------------

function readXmp(bytes: Uint8Array, meta: PanoramaMetadata) {
  let xml = "";
  // XMP is UTF-8 XML; the attributes needed here are ASCII.
  for (let i = 0; i < bytes.length; i++) xml += String.fromCharCode(bytes[i]);
  const projection =
    xml.match(/GPano:ProjectionType\s*=\s*["']([^"']+)["']/)?.[1] ??
    xml.match(/<GPano:ProjectionType>([^<]+)</)?.[1];
  if (projection) meta.projection = projection.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Classification for import
// ---------------------------------------------------------------------------

export type PanoramaClassification =
  | { kind: "PANORAMA" }
  /** An Insta360 original that has to be stitched/exported before it is viewable. */
  | { kind: "NEEDS_EXPORT"; reason: string }
  | { kind: "NOT_PANORAMA"; reason: string };

/** Insta360 originals: dual-fisheye photos, 360 video, low-res proxies, raw. */
const INSTA360_ORIGINALS: Record<string, string> = {
  ".insp": "Insta360 original photo — export it as a 360 JPG from the Insta360 app or Studio first",
  ".insv": "Insta360 video — only photos can be imported",
  ".lrv": "Insta360 low-res preview video — skipped",
  ".dng": "RAW photo — export it as a 360 JPG first",
  ".mp4": "Video — only photos can be imported",
};

export function extensionOf(filename: string): string {
  const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
}

/**
 * Whether a file is a viewable 360 panorama.
 *
 * The viewer needs equirectangular JPEG. The XMP projection tag is the
 * authoritative signal; a 2:1 frame is accepted without it, since that is
 * what an equirectangular image is and several export paths drop the XMP.
 */
export function classifyPanorama(filename: string, meta: PanoramaMetadata | null): PanoramaClassification {
  const ext = extensionOf(filename);
  if (INSTA360_ORIGINALS[ext]) return { kind: "NEEDS_EXPORT", reason: INSTA360_ORIGINALS[ext] };
  if (ext !== ".jpg" && ext !== ".jpeg") return { kind: "NOT_PANORAMA", reason: "Not a JPEG photo" };
  if (!meta || meta.width === null || meta.height === null) {
    return { kind: "NOT_PANORAMA", reason: "Could not read the image dimensions" };
  }
  if (meta.projection === "equirectangular") return { kind: "PANORAMA" };
  if (meta.projection && meta.projection !== "equirectangular") {
    return { kind: "NOT_PANORAMA", reason: `Projection is "${meta.projection}", not equirectangular` };
  }
  const ratio = meta.width / meta.height;
  if (Math.abs(ratio - 2) <= 0.02) return { kind: "PANORAMA" };
  return { kind: "NOT_PANORAMA", reason: `A ${meta.width}×${meta.height} image is not a 360 panorama (needs 2:1)` };
}

/** Great-circle distance in metres. */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
