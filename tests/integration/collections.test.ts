import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import {
  addToCollection,
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  removeFromCollection,
  updateCollection,
} from "@/lib/collection-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Collections. What goes wrong without these rules: a private collection
 * showing up for colleagues; a shared one becoming a window onto stores the
 * viewer has no access to; someone else rearranging your collection; and a
 * photo the collector cannot see slipped into a list by its id.
 */

const suffix = `co${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let east: { id: string };
let west: { id: string };
let owner: { id: string };
let manager: { id: string };
let eastPhoto: { id: string };
let westPhoto: { id: string };

function ctx(userId: string, role: Role, extra: Partial<SessionContext> = {}): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Collection Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
    ...extra,
  };
}
const asOwner = () => ctx(owner.id, Role.OWNER);
const asEastManager = () =>
  ctx(manager.id, Role.FACILITIES_MANAGER, {
    grants: [{ scopeType: "PROPERTY", propertyId: east.id, portfolioId: null, regionId: null }],
  });

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `CO ${suffix}`, slug: `co-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
    });
  east = await mk("east");
  west = await mk("west");
  const user = (label: string) =>
    prisma.user.create({ data: { email: `${label}-${suffix}@example.com`, name: label, passwordHash: "x" } });
  owner = await user("owner");
  manager = await user("manager");
  const photo = (propertyId: string) =>
    prisma.evidence.create({
      data: { organizationId: org.id, propertyId, type: "PHOTO", storageKey: `${org.id}/${crypto.randomUUID()}.jpg`, uploadedById: owner.id },
    });
  eastPhoto = await photo(east.id);
  westPhoto = await photo(west.id);
});

beforeEach(async () => {
  await prisma.collection.deleteMany({ where: { organizationId: org.id } });
});

afterAll(async () => {
  await prisma.evidence.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
});

describe("visibility", () => {
  it("keeps a private collection to its maker until it is shared", async () => {
    const c = await createCollection(asOwner(), { name: "Roof damage" });
    expect(await listCollections(asEastManager())).toEqual([]);
    await expect(getCollection(asEastManager(), c.id)).rejects.toThrow(/not found/);

    await updateCollection(asOwner(), c.id, { visibility: "ORGANIZATION" });
    expect((await listCollections(asEastManager())).map((x) => x.name)).toEqual(["Roof damage"]);
  });

  it("shows each viewer only the items on properties they can open", async () => {
    const c = await createCollection(asOwner(), { name: "Region", visibility: "ORGANIZATION" });
    await addToCollection(asOwner(), c.id, [eastPhoto.id, westPhoto.id]);

    expect((await getCollection(asOwner(), c.id)).items).toHaveLength(2);
    const seen = await getCollection(asEastManager(), c.id);
    expect(seen.items.map((i) => i.evidenceId)).toEqual([eastPhoto.id]);
    // The count on the card matches what is inside.
    expect((await listCollections(asEastManager()))[0]._count.items).toBe(1);
  });

  it("filters by creator and sorts by size", async () => {
    const small = await createCollection(asOwner(), { name: "A small", visibility: "ORGANIZATION" });
    const big = await createCollection(asOwner(), { name: "B big", visibility: "ORGANIZATION" });
    await createCollection(asEastManager(), { name: "Mine" });
    await addToCollection(asOwner(), small.id, [eastPhoto.id]);
    await addToCollection(asOwner(), big.id, [eastPhoto.id, westPhoto.id]);

    expect((await listCollections(asEastManager(), { creator: "me" })).map((c) => c.name)).toEqual(["Mine"]);
    expect((await listCollections(asOwner(), { sort: "items" })).map((c) => c.name)).toEqual(["B big", "A small"]);
    expect((await listCollections(asOwner(), { sort: "name" })).map((c) => c.name)).toEqual(["A small", "B big"]);
  });
});

describe("changing", () => {
  it("is only for the maker", async () => {
    const c = await createCollection(asOwner(), { name: "Owner's", visibility: "ORGANIZATION" });
    await expect(addToCollection(asEastManager(), c.id, [eastPhoto.id])).rejects.toThrow(/Only the person who made/);
    await expect(updateCollection(asEastManager(), c.id, { name: "Mine now" })).rejects.toThrow(/Only the person who made/);
    await expect(deleteCollection(asEastManager(), c.id)).rejects.toThrow(/Only the person who made/);
  });

  it("will not collect a photo the collector cannot see", async () => {
    const c = await createCollection(asEastManager(), { name: "East only" });
    await expect(addToCollection(asEastManager(), c.id, [westPhoto.id])).rejects.toThrow(/can't access/);
  });

  it("skips duplicates and leaves the photo itself on removal or delete", async () => {
    const c = await createCollection(asOwner(), { name: "Dupes" });
    expect((await addToCollection(asOwner(), c.id, [eastPhoto.id])).added).toBe(1);
    expect((await addToCollection(asOwner(), c.id, [eastPhoto.id])).added).toBe(0);
    await removeFromCollection(asOwner(), c.id, eastPhoto.id);
    expect((await getCollection(asOwner(), c.id)).items).toEqual([]);

    await addToCollection(asOwner(), c.id, [eastPhoto.id]);
    await deleteCollection(asOwner(), c.id);
    expect(await prisma.evidence.findUnique({ where: { id: eastPhoto.id } })).not.toBeNull();
  });
});
