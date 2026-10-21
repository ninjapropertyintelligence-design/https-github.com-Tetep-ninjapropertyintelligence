import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getStorageProvider } from "@/lib/storage";
import { allRenditionKeys, getOrMakeRendition, makeRendition, renditionKey } from "@/lib/media-renditions";

/**
 * Photo renditions. What goes wrong without them: a 300-photo gallery pulls
 * 300 full-resolution files, and a survey PDF holds every original. What
 * goes wrong with them done carelessly: an enlarged blurry thumbnail, a
 * sideways phone photo, or a resize redone on every view.
 */

const suffix = `mr${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let user: { id: string };

async function storedPhoto(bytes: Buffer) {
  const key = `${org.id}/${crypto.randomUUID()}.jpg`;
  await getStorageProvider().writeBytes(key, bytes);
  return prisma.evidence.create({
    data: { organizationId: org.id, type: "PHOTO", storageKey: key, sizeBytes: bytes.length, uploadedById: user.id },
  });
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `MR ${suffix}`, slug: `mr-${suffix}` } });
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, name: "u", passwordHash: "x" } });
});

afterAll(async () => {
  await prisma.evidence.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.delete({ where: { id: user.id } });
});

describe("makeRendition", () => {
  it("fits within the size, never enlarges, and turns a phone photo upright", async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#336699" } }).jpeg().toBuffer();
    const small = await sharp((await makeRendition(big, "small"))!).metadata();
    expect([small.width, small.height, small.format]).toEqual([400, 300, "jpeg"]);

    const tiny = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#000" } }).png().toBuffer();
    expect((await sharp((await makeRendition(tiny, "medium"))!).metadata()).width).toBe(120);

    // Orientation 6: stored landscape, meant to be viewed portrait.
    const sideways = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#fff" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const upright = await sharp((await makeRendition(sideways, "small"))!).metadata();
    expect([upright.width, upright.height]).toEqual([300, 400]);
  });

  it("gives up on bytes that are not an image", async () => {
    expect(await makeRendition(Buffer.from("not an image"), "small")).toBeNull();
  });
});

describe("getOrMakeRendition", () => {
  it("makes a rendition once, stores and records it, and reuses it", async () => {
    const photo = await storedPhoto(await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#123456" } }).jpeg().toBuffer());
    const first = await getOrMakeRendition(photo, "medium");
    expect(first).not.toBeNull();
    const after = await prisma.evidence.findUniqueOrThrow({ where: { id: photo.id } });
    expect(after.previewKey).toBe(renditionKey(photo.storageKey, "medium"));
    expect((await getStorageProvider().readBytes(after.previewKey!))?.equals(first!)).toBe(true);

    await getOrMakeRendition(after, "small");
    expect((await prisma.evidence.findUniqueOrThrow({ where: { id: photo.id } })).thumbnailKey).toBe(renditionKey(photo.storageKey, "small"));
    // Keys live under the original's, so they stay in the organization's prefix.
    expect(allRenditionKeys(photo.storageKey).every((k) => k.startsWith(`${org.id}/`))).toBe(true);
  });

  it("leaves an uploader's own thumbnail recorded, and returns null for what it cannot resize", async () => {
    const photo = await storedPhoto(await sharp({ create: { width: 900, height: 900, channels: 3, background: "#abcdef" } }).jpeg().toBuffer());
    await prisma.evidence.update({ where: { id: photo.id }, data: { thumbnailKey: `${org.id}/their-thumb.jpg` } });
    const withTheirs = await prisma.evidence.findUniqueOrThrow({ where: { id: photo.id } });
    expect(await getOrMakeRendition(withTheirs, "small")).not.toBeNull();
    expect((await prisma.evidence.findUniqueOrThrow({ where: { id: photo.id } })).thumbnailKey).toBe(`${org.id}/their-thumb.jpg`);

    const broken = await storedPhoto(Buffer.from("corrupt"));
    expect(await getOrMakeRendition(broken, "small")).toBeNull();
  });
});
