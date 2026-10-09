import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { setEmailProviderForTesting, type EmailMessage } from "@/lib/email";
import {
  acceptInvitation,
  createInvitation,
  describeInvitation,
  listPendingInvitations,
  resendInvitation,
  revokeInvitation,
} from "@/lib/invitation-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Invitations. The ways this goes wrong are an admin handing out more power
 * than they hold, a scoped member joining able to see nothing (or
 * everything), a link that works twice, and an existing account having its
 * password replaced by whoever holds the link.
 */

const suffix = `inv${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sent: EmailMessage[] = [];
let org: { id: string };
let otherOrg: { id: string };
let owner: { id: string };
let vendor: { id: string };
let portfolio: { id: string };
let property: { id: string };
let foreignProperty: { id: string };
let counter = 0;

function freshEmail(label: string) {
  counter += 1;
  return `${label}-${counter}-${suffix}@example.com`;
}

function ctxFor(role: Role, userId = owner.id): SessionContext {
  return {
    userId,
    userName: "Olive Owner",
    userEmail: `owner-${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Inv Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

function tokenFrom(message: EmailMessage): string {
  const match = message.text.match(/invite\?token=([A-Za-z0-9_\-%]+)/);
  if (!match) throw new Error("No invitation link in email");
  return decodeURIComponent(match[1]);
}

/** Invites, and returns the token from the email that went out. */
async function invite(input: Parameters<typeof createInvitation>[1], ctx = ctxFor(Role.OWNER)) {
  const result = await createInvitation(ctx, input);
  return { ...result, token: tokenFrom(sent[sent.length - 1]) };
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `Inv ${suffix}`, slug: `inv-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `Inv2 ${suffix}`, slug: `inv2-${suffix}` } });
  owner = await prisma.user.create({
    data: { email: `owner-${suffix}@example.com`, name: "Olive Owner", passwordHash: "x" },
  });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });
  vendor = await prisma.vendor.create({ data: { organizationId: org.id, name: "Capture Co" } });
  portfolio = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const otherPortfolio = await prisma.portfolio.create({ data: { organizationId: otherOrg.id, name: "PF2" } });
  const prop = (organizationId: string, portfolioId: string, name: string) =>
    prisma.property.create({
      data: { organizationId, portfolioId, name: `${name}-${suffix}`, addressLine1: "1 Main", city: "X", state: "TX", postalCode: "1" },
    });
  property = await prop(org.id, portfolio.id, "store");
  foreignProperty = await prop(otherOrg.id, otherPortfolio.id, "foreign");
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

describe("sending an invitation", () => {
  it("emails a link naming the organization and role", async () => {
    const email = freshEmail("viewer");
    const { invitation, emailSent } = await invite({ email, role: Role.VIEWER });

    expect(emailSent).toBe(true);
    expect(invitation.email).toBe(email);
    expect(sent[0].to).toBe(email);
    expect(sent[0].text).toContain("Viewer");
    expect(sent[0].text).toContain(`Inv ${suffix}`);
  });

  it("never returns or stores the token itself", async () => {
    const { invitation, token } = await invite({ email: freshEmail("hash"), role: Role.VIEWER });
    expect(JSON.stringify(invitation)).not.toContain(token);
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row.tokenHash).not.toBe(token);
  });

  it("refuses anyone who cannot manage the team", async () => {
    await expect(createInvitation(ctxFor(Role.FACILITIES_MANAGER), { email: freshEmail("x"), role: Role.VIEWER })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("lets only an Owner invite an Owner", async () => {
    await expect(createInvitation(ctxFor(Role.PORTFOLIO_ADMIN), { email: freshEmail("o"), role: Role.OWNER })).rejects.toMatchObject({
      status: 403,
    });
    await expect(invite({ email: freshEmail("o"), role: Role.OWNER })).resolves.toBeTruthy();
  });

  it("never hands out Platform Admin", async () => {
    await expect(createInvitation(ctxFor(Role.OWNER), { email: freshEmail("p"), role: Role.PLATFORM_ADMIN })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("requires a scoped role to be given somewhere to look", async () => {
    await expect(
      createInvitation(ctxFor(Role.OWNER), { email: freshEmail("fm"), role: Role.FACILITIES_MANAGER }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a grant on another organization's property", async () => {
    await expect(
      createInvitation(ctxFor(Role.OWNER), {
        email: freshEmail("fm"),
        role: Role.FACILITIES_MANAGER,
        grants: [{ scopeType: "PROPERTY", id: foreignProperty.id }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("requires a vendor to belong to a vendor company of this organization", async () => {
    await expect(createInvitation(ctxFor(Role.OWNER), { email: freshEmail("v"), role: Role.VENDOR })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("refuses someone who is already a member", async () => {
    await expect(
      createInvitation(ctxFor(Role.OWNER), { email: `owner-${suffix}@example.com`, role: Role.VIEWER }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("replaces an earlier invitation to the same address", async () => {
    const email = freshEmail("twice");
    const first = await invite({ email, role: Role.VIEWER });
    const second = await invite({ email, role: Role.INSPECTOR, grants: [{ scopeType: "PROPERTY", id: property.id }] });

    expect(await describeInvitation(first.token)).toBeNull();
    expect(await describeInvitation(second.token)).not.toBeNull();
    const pending = (await listPendingInvitations(ctxFor(Role.OWNER))).filter((i) => i.email === email);
    expect(pending).toHaveLength(1);
    expect(pending[0].role).toBe(Role.INSPECTOR);
  });
});

describe("accepting an invitation", () => {
  it("creates the account and exactly the membership the admin chose", async () => {
    const email = freshEmail("newfm");
    const { token } = await invite({
      email,
      role: Role.FACILITIES_MANAGER,
      grants: [{ scopeType: "PROPERTY", id: property.id }],
    });

    const result = await acceptInvitation(token, { name: "Fran Manager", password: "a-good-password" }, null);
    expect(result.existingAccount).toBe(false);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { memberships: { include: { accessGrants: true } } },
    });
    expect(user.name).toBe("Fran Manager");
    expect(await bcrypt.compare("a-good-password", user.passwordHash)).toBe(true);
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0].role).toBe(Role.FACILITIES_MANAGER);
    expect(user.memberships[0].accessGrants.map((g) => g.propertyId)).toEqual([property.id]);
  });

  it("ties a vendor to its company", async () => {
    const email = freshEmail("newvendor");
    const { token } = await invite({ email, role: Role.VENDOR, vendorId: vendor.id });
    await acceptInvitation(token, { name: "Val Vendor", password: "a-good-password" }, null);

    const membership = await prisma.membership.findFirstOrThrow({ where: { user: { email } } });
    expect(membership.vendorId).toBe(vendor.id);
  });

  it("works only once", async () => {
    const { token } = await invite({ email: freshEmail("once"), role: Role.VIEWER });
    await acceptInvitation(token, { name: "Once", password: "a-good-password" }, null);
    await expect(acceptInvitation(token, { name: "Twice", password: "a-good-password" }, null)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("refuses an expired invitation", async () => {
    const { invitation, token } = await invite({ email: freshEmail("old"), role: Role.VIEWER });
    await prisma.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptInvitation(token, { name: "Late", password: "a-good-password" }, null)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("refuses a cancelled invitation", async () => {
    const { invitation, token } = await invite({ email: freshEmail("cancel"), role: Role.VIEWER });
    await revokeInvitation(ctxFor(Role.OWNER), invitation.id);
    expect(await describeInvitation(token)).toBeNull();
  });

  it("refuses a short password without using up the invitation", async () => {
    const { token } = await invite({ email: freshEmail("short"), role: Role.VIEWER });
    await expect(acceptInvitation(token, { name: "Short", password: "short" }, null)).rejects.toMatchObject({
      status: 400,
    });
    expect(await describeInvitation(token)).not.toBeNull();
  });

  it("adds an existing account to the organization without touching its password", async () => {
    const email = freshEmail("existing");
    const originalHash = await bcrypt.hash("their-own-password", 4);
    const existing = await prisma.user.create({ data: { email, name: "Ezra Existing", passwordHash: originalHash } });
    await prisma.membership.create({ data: { userId: existing.id, organizationId: otherOrg.id, role: Role.VIEWER } });

    const { token } = await invite({ email, role: Role.VIEWER });
    expect((await describeInvitation(token))?.hasAccount).toBe(true);

    const result = await acceptInvitation(token, { name: "Someone Else", password: "attacker-password" }, null);
    expect(result.existingAccount).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.id }, include: { memberships: true } });
    expect(after.passwordHash).toBe(originalHash);
    expect(after.name).toBe("Ezra Existing");
    expect(after.memberships.map((m) => m.organizationId).sort()).toEqual([org.id, otherOrg.id].sort());
  });

  it("drops a grant whose property was deleted after the invitation was sent", async () => {
    const doomed = await prisma.property.create({
      data: { organizationId: org.id, portfolioId: portfolio.id, name: `doomed-${suffix}`, addressLine1: "1", city: "X", state: "TX", postalCode: "1" },
    });
    const email = freshEmail("doomed");
    const { token } = await invite({
      email,
      role: Role.INSPECTOR,
      grants: [
        { scopeType: "PROPERTY", id: doomed.id },
        { scopeType: "PROPERTY", id: property.id },
      ],
    });
    await prisma.property.delete({ where: { id: doomed.id } });

    await acceptInvitation(token, { name: "Ida Inspector", password: "a-good-password" }, null);
    const membership = await prisma.membership.findFirstOrThrow({ where: { user: { email } }, include: { accessGrants: true } });
    expect(membership.accessGrants.map((g) => g.propertyId)).toEqual([property.id]);
  });

  it("tells the person who sent it", async () => {
    const { token } = await invite({ email: freshEmail("tell"), role: Role.VIEWER });
    await acceptInvitation(token, { name: "Tia Viewer", password: "a-good-password" }, null);
    const note = await prisma.notification.findFirst({ where: { userId: owner.id, type: "USER_INVITED" }, orderBy: { createdAt: "desc" } });
    expect(note?.title).toContain("Tia Viewer");
  });
});

describe("resending", () => {
  it("sends a new link and kills the old one", async () => {
    const { invitation, token } = await invite({ email: freshEmail("resend"), role: Role.VIEWER });
    await resendInvitation(ctxFor(Role.OWNER), invitation.id);
    const newToken = tokenFrom(sent[sent.length - 1]);

    expect(newToken).not.toBe(token);
    expect(await describeInvitation(token)).toBeNull();
    expect(await describeInvitation(newToken)).not.toBeNull();
  });

  it("cannot reach another organization's invitation", async () => {
    const { invitation } = await invite({ email: freshEmail("foreign"), role: Role.VIEWER });
    const outsider = { ...ctxFor(Role.OWNER), organizationId: otherOrg.id };
    await expect(resendInvitation(outsider, invitation.id)).rejects.toMatchObject({ status: 404 });
    await expect(revokeInvitation(outsider, invitation.id)).rejects.toMatchObject({ status: 404 });
  });
});
