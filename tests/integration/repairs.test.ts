import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { setEmailProviderForTesting } from "@/lib/email";
import { createEvidence } from "@/lib/evidence-service";
import { sendBackRepair, startRepair, submitRepair, verifyRepair } from "@/lib/repair-service";
import { canAccessProperty, type SessionContext } from "@/lib/tenant-scope";

/**
 * Repairs. What goes wrong without these rules: a contractor who can never
 * upload proof, or who keeps access to the building forever; a repair marked
 * done with no evidence; someone approving their own work; and a send-back
 * answered with the very photos that were just rejected.
 */

const suffix = `rp${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let property: { id: string };
let otherProperty: { id: string };
let asset: { id: string };
let vendor: { id: string };
let owner: { id: string };
let manager: { id: string };
let technician: { id: string };
let vendorUser: { id: string };

function ctx(userId: string, role: Role, extra: Partial<SessionContext> = {}): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Repair Org",
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
const asManager = () =>
  ctx(manager.id, Role.FACILITIES_MANAGER, {
    grants: [{ scopeType: "PROPERTY", propertyId: property.id, portfolioId: null, regionId: null }],
  });
const asTechnician = () =>
  ctx(technician.id, Role.TECHNICIAN, {
    grants: [{ scopeType: "PROPERTY", propertyId: property.id, portfolioId: null, regionId: null }],
  });
const asVendor = () => ctx(vendorUser.id, Role.VENDOR, { vendorId: vendor.id });

async function vendorRepair(assetId: string | null = asset.id) {
  return prisma.issue.create({
    data: {
      organizationId: org.id,
      propertyId: property.id,
      assetId,
      title: `Roof leak ${suffix}`,
      severity: "HIGH",
      status: "ASSIGNED",
      vendorId: vendor.id,
      createdById: owner.id,
    },
  });
}

async function photo(c: SessionContext, issueId: string, stage: "BEFORE" | "AFTER") {
  return createEvidence(c, {
    type: "PHOTO",
    storageKey: `${property.id}/${crypto.randomUUID()}-${stage}.jpg`,
    propertyId: property.id,
    issueId,
    repairStage: stage,
  });
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `RP ${suffix}`, slug: `rp-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "TX", postalCode: "1" },
    });
  property = await mk("store");
  otherProperty = await mk("other");
  asset = await prisma.asset.create({
    data: { organizationId: org.id, propertyId: property.id, name: "Roof", assetType: "Roof", conditionScore: 30 },
  });
  vendor = await prisma.vendor.create({ data: { organizationId: org.id, name: "ABC Roofing" } });
  const user = (label: string) =>
    prisma.user.create({ data: { email: `${label}-${suffix}@example.com`, name: label, passwordHash: "x" } });
  owner = await user("owner");
  manager = await user("manager");
  technician = await user("technician");
  vendorUser = await user("vendor");
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });
  await prisma.membership.create({
    data: {
      userId: manager.id,
      organizationId: org.id,
      role: Role.FACILITIES_MANAGER,
      accessGrants: { create: [{ scopeType: "PROPERTY", propertyId: property.id }] },
    },
  });
  await prisma.membership.create({
    data: { userId: vendorUser.id, organizationId: org.id, role: Role.VENDOR, vendorId: vendor.id },
  });
});

beforeEach(async () => {
  setEmailProviderForTesting({ name: "silent", send: async () => {} });
  await prisma.issue.deleteMany({ where: { organizationId: org.id } });
  await prisma.notification.deleteMany({ where: { organizationId: org.id } });
});

afterEach(() => {
  setEmailProviderForTesting({ name: "silent", send: async () => {} });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
});

describe("the repairer's access", () => {
  it("reaches the building only while a repair there is open", async () => {
    expect(await canAccessProperty(asVendor(), property.id)).toBe(false);
    const issue = await vendorRepair();
    expect(await canAccessProperty(asVendor(), property.id)).toBe(true);
    expect(await canAccessProperty(asVendor(), otherProperty.id)).toBe(false);

    await photo(asVendor(), issue.id, "AFTER");
    await submitRepair(asVendor(), issue.id, { notes: "Patched the membrane" });
    await verifyRepair(asManager(), issue.id);
    expect(await canAccessProperty(asVendor(), property.id)).toBe(false);
  });

  it("can upload proof to its own repair, and not to someone else's", async () => {
    const ours = await vendorRepair();
    const theirs = await prisma.issue.create({
      data: { organizationId: org.id, propertyId: property.id, title: "Not yours", createdById: owner.id },
    });
    const ok = await photo(asVendor(), ours.id, "BEFORE");
    expect(ok.repairStage).toBe("BEFORE");
    // Repair proof is reviewed with the repair, not held as capture work.
    expect(ok.captureJobSiteId).toBeNull();
    await expect(photo(asVendor(), theirs.id, "AFTER")).rejects.toMatchObject({ status: 400 });
  });
});

describe("marking it done", () => {
  it("needs an after-photo", async () => {
    const issue = await vendorRepair();
    await photo(asVendor(), issue.id, "BEFORE");
    await expect(submitRepair(asVendor(), issue.id, { notes: "Fixed" })).rejects.toMatchObject({ status: 400 });
  });

  it("needs a word about what was done", async () => {
    const issue = await vendorRepair();
    await photo(asVendor(), issue.id, "AFTER");
    await expect(submitRepair(asVendor(), issue.id, { notes: "   " })).rejects.toMatchObject({ status: 400 });
  });

  it("waits for a check, records the cost, and tells the building's managers", async () => {
    const issue = await vendorRepair();
    await startRepair(asVendor(), issue.id);
    await photo(asVendor(), issue.id, "AFTER");
    const done = await submitRepair(asVendor(), issue.id, { notes: "Replaced flashing", actualCost: 125000 });

    expect(done.status).toBe("RESOLVED");
    expect(done.actualCost).toBe(125000);
    expect(done.repairSubmittedById).toBe(vendorUser.id);
    const told = await prisma.notification.findMany({ where: { organizationId: org.id, type: "REPAIR_SUBMITTED" } });
    expect(told.map((n) => n.userId).sort()).toEqual([manager.id, owner.id].sort());
  });

  it("is only for whoever was sent to do it", async () => {
    const issue = await vendorRepair();
    await photo(asOwner(), issue.id, "AFTER");
    await expect(submitRepair(asTechnician(), issue.id, { notes: "Not mine" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("checking it", () => {
  async function submitted() {
    const issue = await vendorRepair();
    await photo(asVendor(), issue.id, "AFTER");
    await submitRepair(asVendor(), issue.id, { notes: "Done" });
    return issue;
  }

  it("accepts it, records the asset's new condition, and tells the repairer", async () => {
    const issue = await submitted();
    const verified = await verifyRepair(asManager(), issue.id, { conditionScore: 85 });

    expect(verified.status).toBe("VERIFIED");
    expect(verified.verifiedById).toBe(manager.id);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).conditionScore).toBe(85);
    const history = await prisma.assetConditionHistory.findFirst({
      where: { assetId: asset.id },
      orderBy: { changedAt: "desc" },
    });
    expect(history?.reason).toContain("Repaired");
    expect(history?.evidenceId).not.toBeNull();
    const told = await prisma.notification.findMany({ where: { userId: vendorUser.id, type: "REPAIR_VERIFIED" } });
    expect(told).toHaveLength(1);
  });

  it("is refused to a role that cannot check repairs", async () => {
    const issue = await submitted();
    await expect(verifyRepair(asTechnician(), issue.id)).rejects.toMatchObject({ status: 403 });
  });

  it("is refused to the person who did the repair", async () => {
    const issue = await prisma.issue.create({
      data: {
        organizationId: org.id,
        propertyId: property.id,
        title: "Self-check",
        status: "ASSIGNED",
        assigneeId: manager.id,
        createdById: owner.id,
      },
    });
    await photo(asManager(), issue.id, "AFTER");
    await submitRepair(asManager(), issue.id, { notes: "Fixed it myself" });
    await expect(verifyRepair(asManager(), issue.id)).rejects.toMatchObject({ status: 403 });
    await expect(verifyRepair(asOwner(), issue.id)).resolves.toMatchObject({ status: "VERIFIED" });
  });

  it("cannot check a repair nobody has marked done", async () => {
    const issue = await vendorRepair();
    await expect(verifyRepair(asOwner(), issue.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("sending it back", () => {
  it("needs a reason, reopens the work, and does not accept the rejected photos again", async () => {
    const issue = await vendorRepair();
    await photo(asVendor(), issue.id, "AFTER");
    await submitRepair(asVendor(), issue.id, { notes: "Done" });

    await expect(sendBackRepair(asOwner(), issue.id, " ")).rejects.toMatchObject({ status: 400 });
    const back = await sendBackRepair(asOwner(), issue.id, "Still leaking at the drain");
    expect(back.status).toBe("IN_PROGRESS");
    expect(back.repairSentBackReason).toBe("Still leaking at the drain");
    const told = await prisma.notification.findFirst({ where: { userId: vendorUser.id, type: "REPAIR_SENT_BACK" } });
    expect(told?.body).toBe("Still leaking at the drain");

    // The old after-photo no longer counts.
    await expect(submitRepair(asVendor(), issue.id, { notes: "Done again" })).rejects.toMatchObject({ status: 400 });
    await new Promise((r) => setTimeout(r, 5));
    await photo(asVendor(), issue.id, "AFTER");
    await expect(submitRepair(asVendor(), issue.id, { notes: "Resealed the drain" })).resolves.toMatchObject({
      status: "RESOLVED",
    });
  });
});
