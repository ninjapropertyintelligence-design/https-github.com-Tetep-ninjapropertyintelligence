import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { getPropertyMedia } from "@/lib/media-gallery";
import { addEvidenceComment, addStandardTagTypes, getVocabulary, setEvidenceFlag, setEvidenceTags } from "@/lib/tag-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * The gallery's read. What goes wrong without these rules: a site's photos
 * shown to someone scoped elsewhere; a vendor's unreviewed upload in the
 * client's gallery; documents mixed in with photos; and filters that cannot
 * work because the tags or flag never reach the page.
 */

const suffix = `mg${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let store: { id: string };
let other: { id: string };
let owner: { id: string };

function ctx(role: Role, propertyId?: string): SessionContext {
  return {
    userId: owner.id,
    userName: "Owner",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Gallery Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: propertyId ? [{ scopeType: "PROPERTY", propertyId, portfolioId: null, regionId: null }] : [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

const evidence = (propertyId: string, type: "PHOTO" | "IMAGE_360" | "DOCUMENT", extra: Record<string, unknown> = {}) =>
  prisma.evidence.create({
    data: { organizationId: org.id, propertyId, type, storageKey: `${org.id}/${crypto.randomUUID()}`, uploadedById: owner.id, ...extra },
  });

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `MG ${suffix}`, slug: `mg-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
    });
  store = await mk("store");
  other = await mk("other");
  owner = await prisma.user.create({ data: { email: `${suffix}@example.com`, name: "Owner", passwordHash: "x" } });
  await addStandardTagTypes(ctx(Role.OWNER));
});

afterAll(async () => {
  await prisma.evidence.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.delete({ where: { id: owner.id } });
});

describe("property media", () => {
  it("lists photos and panoramas with their tags, flag and comment counts, newest first", async () => {
    const older = await evidence(store.id, "PHOTO", { captureDate: new Date("2026-09-01") });
    const newer = await evidence(store.id, "IMAGE_360", { captureDate: new Date("2026-10-01") });
    await evidence(store.id, "DOCUMENT");
    const roof = (await getVocabulary(ctx(Role.OWNER), store.id)).find((t) => t.name === "Level")!.values.find((v) => v.name === "Roof")!;
    await setEvidenceTags(ctx(Role.OWNER), older.id, [roof.id]);
    await setEvidenceFlag(ctx(Role.OWNER), older.id, true);
    await addEvidenceComment(ctx(Role.OWNER), older.id, "check the flashing");

    const { items, truncated } = await getPropertyMedia(ctx(Role.OWNER), store.id);
    expect(truncated).toBe(false);
    expect(items.map((i) => i.id)).toEqual([newer.id, older.id]);
    expect(items[1]).toMatchObject({ type: "PHOTO", isFlagged: true, tagValueIds: [roof.id], comments: 1, capturedKnown: true, uploadedBy: "Owner" });
  });

  it("is not available outside the viewer's scope, and hides vendor work under review", async () => {
    await expect(getPropertyMedia(ctx(Role.FACILITIES_MANAGER, other.id), store.id)).rejects.toThrow(/Property not found/);

    const vendor = await prisma.vendor.create({ data: { organizationId: org.id, name: "Capture Co" } });
    const job = await prisma.captureJob.create({ data: { organizationId: org.id, vendorId: vendor.id, title: "Job" } });
    const site = await prisma.captureJobSite.create({ data: { jobId: job.id, propertyId: store.id } });
    const pending = await evidence(store.id, "PHOTO", { captureJobSiteId: site.id });
    const seen = await getPropertyMedia(ctx(Role.FACILITIES_MANAGER, store.id), store.id);
    expect(seen.items.map((i) => i.id)).not.toContain(pending.id);
  });
});
