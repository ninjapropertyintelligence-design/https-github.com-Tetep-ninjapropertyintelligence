import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { getStorageProvider } from "@/lib/storage";
import {
  allRenditionKeys,
  getOrMakePanoramaStrip,
  panoramaStripCount,
  panoramaStripUrls,
  stripKey,
} from "@/lib/media-renditions";

/**
 * A panorama too big for one response is served as full-resolution strips.
 * The claim that matters: stacked, the strips are the original's exact size,
 * and none of them is too big to send.
 */

const storageKey = `test-strips/${Date.now()}-pano.jpg`;
const width = 5760;
const height = 2880;
let sizeBytes = 0;

beforeAll(async () => {
  // Noise compresses badly, so this is a worst case for strip size.
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 251;
  const jpeg = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  sizeBytes = jpeg.byteLength;
  await getStorageProvider().writeBytes(storageKey, jpeg);
});

afterAll(async () => {
  const storage = getStorageProvider();
  for (const key of [storageKey, ...allRenditionKeys(storageKey, sizeBytes)]) await storage.delete(key).catch(() => {});
});

describe("panorama strips", () => {
  it("sends a small panorama whole and a big one in strips", () => {
    expect(panoramaStripCount(3 * 1024 * 1024)).toBe(1);
    expect(panoramaStripUrls("e1", 3 * 1024 * 1024)).toEqual(["/api/v1/evidence/e1/content"]);
    expect(panoramaStripCount(11 * 1024 * 1024)).toBe(5);
    expect(panoramaStripUrls("e1", 11 * 1024 * 1024)[4]).toBe("/api/v1/evidence/e1/content?strip=4&of=5");
  });

  it("rebuilds the original at full resolution, each strip small enough to send", async () => {
    const count = panoramaStripCount(sizeBytes);
    expect(count).toBeGreaterThan(1);
    let stackedHeight = 0;
    for (let index = 0; index < count; index++) {
      const strip = await getOrMakePanoramaStrip({ storageKey, sizeBytes }, index, count);
      expect(strip).not.toBeNull();
      expect(strip!.byteLength).toBeLessThanOrEqual(4 * 1024 * 1024);
      const meta = await sharp(strip!).metadata();
      expect(meta.width).toBe(width);
      stackedHeight += meta.height!;
    }
    expect(stackedHeight).toBe(height);
  });

  it("refuses a strip outside the panorama or a count it was not split into", async () => {
    const count = panoramaStripCount(sizeBytes);
    expect(await getOrMakePanoramaStrip({ storageKey, sizeBytes }, count, count)).toBeNull();
    expect(await getOrMakePanoramaStrip({ storageKey, sizeBytes }, 0, count + 1)).toBeNull();
    expect(await getOrMakePanoramaStrip({ storageKey, sizeBytes }, -1, count)).toBeNull();
  });

  it("lists the strips for deletion", () => {
    const count = panoramaStripCount(sizeBytes);
    expect(allRenditionKeys(storageKey, sizeBytes)).toContain(stripKey(storageKey, count - 1, count));
    expect(allRenditionKeys(storageKey)).not.toContain(stripKey(storageKey, 0, count));
  });
});
