import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import {
  createContractor,
  deleteContractor,
  getContractor,
  listContractors,
  setAssetContractor,
  updateContractor,
  whoToCall,
} from "@/lib/contractor-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Contractors. What goes wrong without these rules: a regional manager
 * assigning a contractor to another region's store; a contractor's own login
 * reading every other contractor's phone numbers; one organization's
 * contractor named on another's equipment; saving a regional list quietly
 * dropping the stores that manager cannot see; and "who do I call" returning
 * nobody for equipment no one has assigned.
 */

const suffix = `ct${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let storeA: { id: string };
let storeB: { id: string };
let owner: { id: string };
let manager: { id: string };
let viewer: { id: string };
let vendorUser: { id: string };
let assetA: { id: string };
let foreignVendor: { id: string };

function ctx(userId: string, role: Role, extra: Partial<SessionContext> = {}): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Contractor Org",
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
// A facilities manager who sees store A only.
const asManager = () =>
  ctx(manager.id, Role.FACILITIES_MANAGER, { grants: [{ scopeType: "PROPERTY", propertyId: storeA.id, portfolioId: null, regionId: null }] });
const asViewer = () => ctx(viewer.id, Role.VIEWER);
const asVendor = () => ctx(vendorUser.id, Role.VENDOR, { vendorId: "some-vendor" });

const fridgeTech = {
  name: "Midwest Refrigeration",
  trade: "Refrigeration",
  contactName: "Dana",
  contactPhone: "(913) 555-0142",
  emergencyPhone: "(913) 555-0199",
  servesAllProperties: false,
};

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `CT ${suffix}`, slug: `ct-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `CT other ${suffix}`, slug: `ct-other-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
    });
  storeA = await mk("A");
  storeB = await mk("B");
  const user = (label: string) => prisma.user.create({ data: { email: `${label}-${suffix}@example.com`, name: label, passwordHash: "x" } });
  owner = await user("owner");
  manager = await user("manager");
  viewer = await user("viewer");
  vendorUser = await user("vendor");
  assetA = await prisma.asset.create({
    data: { organizationId: org.id, propertyId: storeA.id, name: "Walk-in", assetType: "Walk-In Cooler & Freezer" },
  });
  foreignVendor = await prisma.vendor.create({ data: { organizationId: otherOrg.id, name: "Someone Else" } });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, manager.id, viewer.id, vendorUser.id] } } });
});

describe("contractors", () => {
  it("keeps the numbers an owner enters, and normalises blanks to nothing", async () => {
    const v = await createContractor(asOwner(), { ...fridgeTech, contactEmail: "", notes: "  ", propertyIds: [storeA.id] });
    expect(v.emergencyPhone).toBe("(913) 555-0199");
    expect(v.contactEmail).toBeNull();
    expect(v.notes).toBeNull();
    const detail = await getContractor(asOwner(), v.id);
    expect(detail.properties.map((p) => p.propertyId)).toEqual([storeA.id]);
  });

  it("refuses a bad email, a missing name, and a viewer adding a contractor", async () => {
    await expect(createContractor(asOwner(), { name: "X", contactEmail: "nope" })).rejects.toThrow();
    await expect(createContractor(asOwner(), { name: "  " })).rejects.toThrow();
    await expect(createContractor(asViewer(), fridgeTech)).rejects.toMatchObject({ status: 403 });
  });

  it("does not let a contractor's own login read the contractor directory", async () => {
    await expect(listContractors(asVendor())).rejects.toMatchObject({ status: 403 });
  });

  it("lets a viewer read the directory but not change it", async () => {
    const items = await listContractors(asViewer());
    expect(items.length).toBeGreaterThan(0);
    const [first] = items;
    await expect(updateContractor(asViewer(), first.id, { ...fridgeTech })).rejects.toMatchObject({ status: 403 });
    await expect(deleteContractor(asViewer(), first.id)).rejects.toMatchObject({ status: 403 });
  });

  it("will not assign a contractor to a store the manager cannot see", async () => {
    await expect(createContractor(asManager(), { ...fridgeTech, name: "Bad", propertyIds: [storeB.id] })).rejects.toMatchObject({ status: 400 });
  });

  it("filters to the contractors that serve one store: all-store ones and listed ones", async () => {
    const all = await createContractor(asOwner(), { name: "Everywhere Plumbing", trade: "Plumbing", servesAllProperties: true });
    const onlyB = await createContractor(asOwner(), { name: "B Only HVAC", trade: "HVAC", propertyIds: [storeB.id] });
    const atA = (await listContractors(asOwner(), { propertyId: storeA.id })).map((v) => v.id);
    expect(atA).toContain(all.id);
    expect(atA).not.toContain(onlyB.id);
    const hvac = await listContractors(asOwner(), { trade: "HVAC" });
    expect(hvac.map((v) => v.id)).toEqual([onlyB.id]);
  });

  it("keeps the stores a regional manager cannot see when they save their own list", async () => {
    const v = await createContractor(asOwner(), { ...fridgeTech, name: "Shared Fridge Co", propertyIds: [storeA.id, storeB.id] });
    // The manager sees store A only, and unticks it.
    await updateContractor(asManager(), v.id, { ...fridgeTech, name: "Shared Fridge Co", propertyIds: [] });
    const after = await getContractor(asOwner(), v.id);
    expect(after.properties.map((p) => p.propertyId)).toEqual([storeB.id]);
  });

  it("points an asset at its contractor, and puts that contractor first in who to call", async () => {
    const v = await createContractor(asOwner(), { ...fridgeTech, name: "Assigned Fridge Co", propertyIds: [storeA.id] });
    const nearby = await createContractor(asOwner(), { name: "Nearby Electric", trade: "Electrical", servesAllProperties: true });
    await setAssetContractor(asOwner(), assetA.id, v.id);
    const call = await whoToCall(asOwner(), assetA.id);
    expect(call.assigned?.id).toBe(v.id);
    expect(call.others.map((o) => o.id)).toContain(nearby.id);
    expect(call.others.map((o) => o.id)).not.toContain(v.id);
    // The detail page lists the equipment it services.
    expect((await getContractor(asOwner(), v.id)).serviceAssets.map((a) => a.id)).toContain(assetA.id);
  });

  it("still says who to call for equipment no one has assigned", async () => {
    await setAssetContractor(asOwner(), assetA.id, null);
    const call = await whoToCall(asOwner(), assetA.id);
    expect(call.assigned).toBeNull();
    expect(call.others.length).toBeGreaterThan(0);
  });

  it("will not name another organization's contractor on equipment", async () => {
    await expect(setAssetContractor(asOwner(), assetA.id, foreignVendor.id)).rejects.toMatchObject({ status: 404 });
  });

  it("clears the equipment's contractor when the contractor is deleted", async () => {
    const v = await createContractor(asOwner(), { name: "Goes Away", servesAllProperties: true });
    await setAssetContractor(asOwner(), assetA.id, v.id);
    await deleteContractor(asOwner(), v.id);
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetA.id } });
    expect(asset.serviceVendorId).toBeNull();
  });

  it("refuses to delete a contractor that has a team login", async () => {
    const v = await createContractor(asOwner(), { name: "Has Login", servesAllProperties: true });
    await prisma.membership.create({ data: { userId: vendorUser.id, organizationId: org.id, role: Role.VENDOR, vendorId: v.id } });
    await expect(deleteContractor(asOwner(), v.id)).rejects.toMatchObject({ status: 409 });
  });
});
