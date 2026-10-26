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

/**
 * `large` is for 360 panoramas: a camera's 11 MB equirectangular original is
 * too big to serve from a function (Vercel caps a response at 4.5 MB), and
 * 4096×2048 is still sharp inside the viewer.
 */
export const RENDITION_SIZES = { small: 400, medium: 1600, large: 4096 } as const;
export type RenditionSize = keyof typeof RENDITION_SIZES;

/** Past this the original is not decoded here; the caller serves it as is. */
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

/** A rendition must fit in one function response, with room to spare. */
export const MAX_RENDITION_BYTES = 4 * 1024 * 1024;

export function renditionKey(storageKey: string, size: RenditionSize): string {
  return `${storageKey}~${size}.jpg`;
}

/** Every rendition key an original can have, for deletion. */
export function allRenditionKeys(storageKey: string): string[] {
  return (Object.keys(RENDITION_SIZES) as RenditionSize[]).map((size) => renditionKey(storageKey, size));
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
  const encode = (quality: number) =>
    sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  try {
    const first = await encode(size === "small" ? 72 : size === "medium" ? 80 : 78);
    // A very detailed panorama can come out too big at the usual quality.
    return first.byteLength <= MAX_RENDITION_BYTES ? first : await encode(60);
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
    data: size === "medium" ? { previewKey: key } : size === "large" || evidence.thumbnailKey ? {} : { thumbnailKey: key },
  });
  return rendition;
}
