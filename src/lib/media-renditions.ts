import { prisma } from "@/lib/prisma";
import { getStorageProvider } from "@/lib/storage";

/**
 * Smaller copies of photos, so a gallery of 300 thumbnails does not download
 * 300 full-resolution files.
 *
 * Made on first request and kept: the first viewer of a photo pays for its
 * resize once, every later one gets the stored copy, and photos uploaded
 * before this existed are covered without a backfill job. Keys are derived
 * from the original's, so they are always under the same organization's
 * prefix and retention can find them even when nothing recorded them.
 */

export const RENDITION_SIZES = { small: 400, medium: 1600 } as const;
export type RenditionSize = keyof typeof RENDITION_SIZES;

/** Past this the original is not decoded here; the caller serves it as is. */
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

export function renditionKey(storageKey: string, size: RenditionSize): string {
  return `${storageKey}~${size}.jpg`;
}

/**
 * Every rendition key an original can have, for deletion. Pass a panorama's
 * size to include its strips, whose count follows from it.
 */
export function allRenditionKeys(storageKey: string, panoramaBytes?: bigint | number | null): string[] {
  const keys = (Object.keys(RENDITION_SIZES) as RenditionSize[]).map((size) => renditionKey(storageKey, size));
  const strips = panoramaBytes == null ? 0 : panoramaStripCount(panoramaBytes);
  for (let index = 0; index < strips; index++) keys.push(stripKey(storageKey, index, strips));
  return keys;
}

// ---------------------------------------------------------------------------
// Full-resolution panorama strips
// ---------------------------------------------------------------------------

/**
 * A 360 viewer needs the panorama's bytes from this origin (WebGL refuses a
 * cross-origin texture), and one function response may carry at most 4.5 MB.
 * So a panorama bigger than that is served as horizontal strips at its full
 * resolution, which the viewer stitches back into the whole image: nothing
 * is scaled down. The count is derived from the original's size alone, so
 * every caller, and deletion, arrives at the same keys.
 */
const STRIP_TARGET_BYTES = 2.5 * 1024 * 1024;
const PROXY_LIMIT_BYTES = 4 * 1024 * 1024;
const MAX_STRIPS = 16;

/** How many strips a panorama is served as; 1 means the original fits whole. */
export function panoramaStripCount(sizeBytes: bigint | number | null): number {
  if (sizeBytes === null) return 1;
  const bytes = Number(sizeBytes);
  if (bytes <= PROXY_LIMIT_BYTES) return 1;
  return Math.min(MAX_STRIPS, Math.ceil(bytes / STRIP_TARGET_BYTES));
}

export function stripKey(storageKey: string, index: number, count: number): string {
  return `${storageKey}~strip-${index}-of-${count}.jpg`;
}

/** The URLs a viewer loads, top to bottom, for one panorama. */
export function panoramaStripUrls(evidenceId: string, sizeBytes: bigint | number | null): string[] {
  const count = panoramaStripCount(sizeBytes);
  if (count === 1) return [`/api/v1/evidence/${evidenceId}/content`];
  return Array.from({ length: count }, (_, index) => `/api/v1/evidence/${evidenceId}/content?strip=${index}&of=${count}`);
}

/**
 * Band `index` of `count` across the full width of the original, at its own
 * resolution. JPEG at quality 92, which is visually indistinguishable from a
 * camera's own JPEG; only a band that would not fit one response is encoded
 * lower. Null when the original cannot be read or decoded.
 */
export async function getOrMakePanoramaStrip(
  evidence: { storageKey: string; sizeBytes: bigint | number | null },
  index: number,
  count: number,
): Promise<Buffer | null> {
  if (!Number.isInteger(index) || index < 0 || index >= count || count !== panoramaStripCount(evidence.sizeBytes)) return null;
  const storage = getStorageProvider();
  const key = stripKey(evidence.storageKey, index, count);
  const stored = await storage.readBytes(key);
  if (stored) return stored;

  const original = await storage.readBytes(evidence.storageKey);
  if (!original || original.byteLength > MAX_SOURCE_BYTES) return null;
  const { default: sharp } = await import("sharp");
  try {
    const { width, height } = await sharp(original).metadata();
    if (!width || !height) return null;
    const band = Math.ceil(height / count);
    const top = band * index;
    const bandHeight = Math.min(band, height - top);
    if (bandHeight <= 0) return null;
    const encode = (quality: number) =>
      sharp(original, { failOn: "error" })
        .extract({ left: 0, top, width, height: bandHeight })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
    let strip = await encode(92);
    if (strip.byteLength > PROXY_LIMIT_BYTES) strip = await encode(85);
    if (strip.byteLength > PROXY_LIMIT_BYTES) strip = await encode(75);
    await storage.writeBytes(key, strip);
    return strip;
  } catch {
    return null;
  }
}

/**
 * Resizes to fit within the size's longest edge, never enlarging, upright
 * per the camera's orientation tag, as a JPEG — readable everywhere,
 * including by the PDF report. Null when the bytes are not an image this can
 * decode (HEIC from some phones, a video), so the caller falls back to the
 * original.
 */
export async function makeRendition(bytes: Buffer, size: RenditionSize): Promise<Buffer | null> {
  const { default: sharp } = await import("sharp");
  const edge = RENDITION_SIZES[size];
  try {
    return await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: size === "small" ? 72 : 80, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * The stored rendition for one photo, made now if it does not exist yet.
 * Null when one cannot be made — too large to decode here, missing from
 * storage, or not an image — in which case the original is what to serve.
 */
export async function getOrMakeRendition(
  evidence: { id: string; storageKey: string; sizeBytes: bigint | number | null; thumbnailKey: string | null; previewKey: string | null },
  size: RenditionSize,
): Promise<Buffer | null> {
  const storage = getStorageProvider();
  const key = renditionKey(evidence.storageKey, size);
  const stored = await storage.readBytes(key);
  if (stored) return stored;

  if (evidence.sizeBytes !== null && Number(evidence.sizeBytes) > MAX_SOURCE_BYTES) return null;
  const original = await storage.readBytes(evidence.storageKey);
  if (!original || original.byteLength > MAX_SOURCE_BYTES) return null;
  const rendition = await makeRendition(original, size);
  if (!rendition) return null;

  await storage.writeBytes(key, rendition);
  // Recorded where there is a column for it. A thumbnail the uploader
  // supplied is left in place; ours is still found by its derived key.
  await prisma.evidence.update({
    where: { id: evidence.id },
    data: size === "medium" ? { previewKey: key } : evidence.thumbnailKey ? {} : { thumbnailKey: key },
  });
  return rendition;
}
