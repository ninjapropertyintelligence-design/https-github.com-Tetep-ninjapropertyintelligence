import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { setEmailProviderForTesting, type EmailMessage } from "@/lib/email";
import { removeMember, updateMembership } from "@/lib/member-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Changing roles and removing members. What goes wrong here is an admin
 * handing out more than they hold, locking themselves (or everyone) out by
 * removing the last Owner, and stale access surviving a role change.
 */

const suffix = `mem${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sent: EmailMessage[] = [];
let org: { id: string };
let otherOrg: { id: string };
let property: { id: string };
let otherProperty: { id: string };
let foreignProperty: { id: string };
let vendor: { id: string };
let counter = 0;

async function member(role: Role, extra: { vendorId?: string; propertyIds?: string[] } = {}) {
  counter += 1;
  const user = await prisma.user.create({
    data: { email: `m${counter}-${suffix}@example.com`, name: `Member ${counter}`, passwordHash: "x" },
  });
  const membership = await prisma.membership.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      role,
      vendorId: extra.vendorId ?? null,
      accessGrants: { create: (extra.propertyIds ?? []).map((propertyId) => ({ scopeType: "PROPERTY" as const, propertyId })) },
    },
  });
  return { user, membership };
}

function ctxAs(m: { user: { id: string; name: string }; membership: { role: Role } }): SessionContext {
  return {
    userId: m.user.id,
    userName: m.user.name,
    userEmail: "irrelevant@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Mem Org",
    membershipId: "irrelevant",
    role: m.membership.role,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `Mem ${suffix}`, slug: `mem-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `Mem2 ${suffix}`, slug: `mem2-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const pf2 = await prisma.portfolio.create({ data: { organizationId: otherOrg.id, name: "PF2" } });
  const prop = (organizationId: string, portfolioId: string, name: string) =>
    prisma.property.create({
      data: { organizationId, portfolioId, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "TX", postalCode: "1" },
    });
  property = await prop(org.id, pf.id, "a");
  otherProperty = await prop(org.id, pf.id, "b");
  foreignProperty = await prop(otherOrg.id, pf2.id, "foreign");
  vendor = await prisma.vendor.create({ data: { organizationId: org.id, name: "Capture Co" } });
});

beforeEach(() => {
  sent = [];
  setEmailProviderForTesting({ name: "recording", send: async (m) => void sent.push(m) });
});

afterEach(() => {
  setEmailProviderForTesting({ name: "silent", send: async () => {} });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
});

describe("changing a role", () => {
  it("replaces the role and the access entirely", async () => {
    const owner = await member(Role.OWNER);
    const target = await member(Role.FACILITIES_MANAGER, { propertyIds: [property.id] });

    const updated = await updateMembership(ctxAs(owner), target.membership.id, {
      role: Role.INSPECTOR,
      grants: [{ scopeType: "PROPERTY", id: otherProperty.id }],
    });

    expect(updated.role).toBe(Role.INSPECTOR);
    // The old property is gone: a leftover grant would be access nobody chose.
    expect(updated.accessGrants.map((g) => g.propertyId)).toEqual([otherProperty.id]);
  });

  it("drops grants when the role becomes organization-wide", async () => {
    const owner = await member(Role.OWNER);
    const target = await member(Role.FACILITIES_MANAGER, { propertyIds: [property.id] });
    const updated = await updateMembership(ctxAs(owner), target.membership.id, { role: Role.VIEWER });
    expect(updated.accessGrants).toHaveLength(0);
  });

  it("ties a member to a vendor company when made a vendor", async () => {
    const owner = await member(Role.OWNER);
    const target = await member(Role.VIEWER);
    const updated = await updateMembership(ctxAs(owner), target.membership.id, { role: Role.VENDOR, vendorId: vendor.id });
    expect(updated.vendorId).toBe(vendor.id);
  });

  it("clears the vendor company when a vendor is moved to another role", async () => {
    const owner = await member(Role.OWNER);
    const target = await member(Role.VENDOR, { vendorId: vendor.id });
    const updated = await updateMembership(ctxAs(owner), target.membership.id, { role: Role.VIEWER });
    expect(updated.vendorId).toBeNull();
  });

  it("emails the member when their role changes", async () => {
    const owner = await member(Role.OWNER);
    const target = await member(Role.VIEWER);
    await updateMembership(ctxAs(owner), target.membership.id, { role: Role.PORTFOLIO_ADMIN });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(target.user.email);
    expect(sent[0].text).toContain("Portfolio Admin");
  });

  it("applies the invitation rules: a scoped role needs somewhere to look", async () => {
    const owner = await member(Role.OWNER);
    const target = await member(Role.VIEWER);
    await expect(updateMembership(ctxAs(owner), target.membership.id, { role: Role.TECHNICIAN })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("refuses a grant on another organization's property", async () => {
    const owner = await member(Role.OWNER);
    const target = await member(Role.VIEWER);
    await expect(
      updateMembership(ctxAs(owner), target.membership.id, {
        role: Role.TECHNICIAN,
        grants: [{ scopeType: "PROPERTY", id: foreignProperty.id }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses anyone who cannot manage the team", async () => {
    const manager = await member(Role.REGIONAL_MANAGER, { propertyIds: [property.id] });
    const target = await member(Role.VIEWER);
    await expect(updateMembership(ctxAs(manager), target.membership.id, { role: Role.PORTFOLIO_ADMIN })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("lets only an Owner make someone an Owner", async () => {
    const admin = await member(Role.PORTFOLIO_ADMIN);
    const target = await member(Role.VIEWER);
    await expect(updateMembership(ctxAs(admin), target.membership.id, { role: Role.OWNER })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("lets only an Owner change an Owner", async () => {
    const admin = await member(Role.PORTFOLIO_ADMIN);
    const owner = await member(Role.OWNER);
    await expect(updateMembership(ctxAs(admin), owner.membership.id, { role: Role.VIEWER })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("refuses to change your own membership", async () => {
    const admin = await member(Role.PORTFOLIO_ADMIN);
    await expect(updateMembership(ctxAs(admin), admin.membership.id, { role: Role.VIEWER })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("cannot reach another organization's member", async () => {
    const owner = await member(Role.OWNER);
    const target = await member(Role.VIEWER);
    const outsider = { ...ctxAs(owner), organizationId: otherOrg.id };
    await expect(updateMembership(outsider, target.membership.id, { role: Role.PORTFOLIO_ADMIN })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("the last Owner", () => {
  it("cannot be demoted or removed, whoever asks", async () => {
    // Unreachable through the other rules today: you cannot change yourself,
    // and only an Owner can change an Owner, so a second Owner always exists.
    // This is the backstop if either rule is ever relaxed, so it is exercised
    // directly, with an Owner-ranked caller who holds no Owner seat here.
    const solo = await prisma.organization.create({ data: { name: `Solo ${suffix}`, slug: `solo-${suffix}` } });
    try {
      counter += 1;
      const user = await prisma.user.create({
        data: { email: `s${counter}-${suffix}@example.com`, name: "Only Owner", passwordHash: "x" },
      });
      const onlyOwner = await prisma.membership.create({ data: { userId: user.id, organizationId: solo.id, role: Role.OWNER } });
      const caller = await member(Role.VIEWER);
      const asOwnerRanked = { ...ctxAs(caller), role: Role.OWNER, organizationId: solo.id };

      await expect(updateMembership(asOwnerRanked, onlyOwner.id, { role: Role.VIEWER })).rejects.toMatchObject({ status: 409 });
      await expect(removeMember(asOwnerRanked, onlyOwner.id)).rejects.toMatchObject({ status: 409 });
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: onlyOwner.id } })).role).toBe(Role.OWNER);
    } finally {
      await prisma.organization.delete({ where: { id: solo.id } });
    }
  });

  it("can be stepped down once another Owner exists", async () => {
    const owner = await member(Role.OWNER);
    const other = await member(Role.OWNER);
    const updated = await updateMembership(ctxAs(owner), other.membership.id, { role: Role.PORTFOLIO_ADMIN });
    expect(updated.role).toBe(Role.PORTFOLIO_ADMIN);
  });
});

describe("removing a member", () => {
  it("removes the membership and its access, and keeps the account", async () => {
    const owner = await member(Role.OWNER);
    const target = await member(Role.FACILITIES_MANAGER, { propertyIds: [property.id] });

    await removeMember(ctxAs(owner), target.membership.id);

    expect(await prisma.membership.findUnique({ where: { id: target.membership.id } })).toBeNull();
    expect(await prisma.accessGrant.count({ where: { membershipId: target.membership.id } })).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: target.user.id } })).not.toBeNull();
  });

  it("leaves the person's other organizations alone", async () => {
    const owner = await member(Role.OWNER);
    const target = await member(Role.VIEWER);
    await prisma.membership.create({ data: { userId: target.user.id, organizationId: otherOrg.id, role: Role.VIEWER } });

    await removeMember(ctxAs(owner), target.membership.id);
    const remaining = await prisma.membership.findMany({ where: { userId: target.user.id } });
    expect(remaining.map((m) => m.organizationId)).toEqual([otherOrg.id]);
  });

  it("tells the person they were removed", async () => {
    const owner = await member(Role.OWNER);
    const target = await member(Role.VIEWER);
    await removeMember(ctxAs(owner), target.membership.id);
    expect(sent.at(-1)?.to).toBe(target.user.email);
    expect(sent.at(-1)?.subject).toMatch(/removed/i);
  });

  it("refuses to remove yourself", async () => {
    const admin = await member(Role.PORTFOLIO_ADMIN);
    await expect(removeMember(ctxAs(admin), admin.membership.id)).rejects.toMatchObject({ status: 400 });
  });

  it("lets only an Owner remove an Owner", async () => {
    const admin = await member(Role.PORTFOLIO_ADMIN);
    const owner = await member(Role.OWNER);
    await expect(removeMember(ctxAs(admin), owner.membership.id)).rejects.toMatchObject({ status: 403 });
  });

  it("records who did it", async () => {
    const owner = await member(Role.OWNER);
    const target = await member(Role.VIEWER);
    await removeMember(ctxAs(owner), target.membership.id);
    const log = await prisma.auditLog.findFirst({
      where: { organizationId: org.id, action: "membership.removed", entityId: target.membership.id },
    });
    expect(log?.actorUserId).toBe(owner.user.id);
  });
});
