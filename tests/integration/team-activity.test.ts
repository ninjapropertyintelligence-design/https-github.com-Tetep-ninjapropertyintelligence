import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { listActivity, listTeamMembers } from "@/lib/team-activity-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * The Team and Activity pages: who is in the organization, what each person
 * can see, when they were last here, and what they did — readable by the
 * Owner and Portfolio Admins, and only about their own organization.
 */

const suffix = `ta${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let owner: { id: string };
let manager: { id: string };
let outsider: { id: string };

function ctx(role: Role, userId = owner.id, organizationId = org.id): SessionContext {
  return {
    userId,
    userName: "TA",
    userEmail: "ta@example.com",
    isPlatformAdmin: false,
    organizationId,
    organizationName: "TA Org",
    membershipId: "m",
    role,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `TA ${suffix}`, slug: `ta-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `TA other ${suffix}`, slug: `ta-other-${suffix}` } });
  owner = await prisma.user.create({ data: { email: `o-${suffix}@example.com`, passwordHash: "x", name: "Olive" } });
  manager = await prisma.user.create({ data: { email: `m-${suffix}@example.com`, passwordHash: "x", name: "Marco" } });
  outsider = await prisma.user.create({ data: { email: `x-${suffix}@example.com`, passwordHash: "x", name: "Xan" } });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });
  await prisma.membership.create({ data: { userId: outsider.id, organizationId: otherOrg.id, role: Role.OWNER } });

  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const midwest = await prisma.region.create({ data: { portfolioId: pf.id, name: "Midwest" } });
  await prisma.membership.create({
    data: {
      userId: manager.id,
      organizationId: org.id,
      role: Role.REGIONAL_MANAGER,
      accessGrants: { create: [{ scopeType: "REGION", regionId: midwest.id }] },
    },
  });

  const now = Date.now();
  await prisma.auditLog.createMany({
    data: [
      { organizationId: org.id, actorUserId: manager.id, action: "login", createdAt: new Date(now - 3 * HOUR) },
      { organizationId: org.id, actorUserId: manager.id, action: "issue.created", createdAt: new Date(now - 2 * HOUR) },
      { organizationId: otherOrg.id, actorUserId: outsider.id, action: "issue.created", createdAt: new Date(now - HOUR) },
    ],
  });
  await prisma.productEvent.create({
    data: { organizationId: org.id, userId: manager.id, feature: "dashboard.viewed", occurredAt: new Date(now - HOUR) },
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [owner.id, manager.id, outsider.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, manager.id, outsider.id] } } });
});

describe("the team list", () => {
  it("says what each person can see and when they were last here", async () => {
    const members = await listTeamMembers(ctx(Role.OWNER));
    const marco = members.find((m) => m.userId === manager.id)!;
    expect(marco.roleLabel).toBe("Regional Manager");
    expect(marco.access).toEqual(["Region: Midwest"]);
    expect(marco.lastSignInAt).not.toBeNull();
    // The page view is the most recent thing they did.
    expect(marco.lastActiveAt!.getTime()).toBeGreaterThan(marco.lastSignInAt!.getTime());
    expect(marco.recentActivityCount).toBe(3);

    const olive = members.find((m) => m.userId === owner.id)!;
    expect(olive.access).toEqual(["Whole organization"]);
    expect(olive.lastSignInAt).toBeNull();
    // Only this organization's people.
    expect(members.some((m) => m.userId === outsider.id)).toBe(false);
  });
});

describe("the activity log", () => {
  it("is readable by the Owner and Portfolio Admins, and refused to everyone else", async () => {
    await expect(listActivity(ctx(Role.OWNER), {})).resolves.toBeTruthy();
    await expect(listActivity(ctx(Role.PORTFOLIO_ADMIN), {})).resolves.toBeTruthy();
    for (const role of [Role.REGIONAL_MANAGER, Role.VIEWER, Role.VENDOR]) {
      await expect(listActivity(ctx(role), {})).rejects.toMatchObject({ status: 403 });
    }
  });

  it("filters by person and by kind, newest first", async () => {
    const all = await listActivity(ctx(Role.PORTFOLIO_ADMIN), { userId: manager.id });
    expect(all.entries.map((e) => e.description)).toEqual(["Opened the dashboard", "Reported an issue", "Signed in"]);

    const logins = await listActivity(ctx(Role.OWNER), { userId: manager.id, kind: "logins" });
    expect(logins.entries.map((e) => e.kind)).toEqual(["login"]);
    const changes = await listActivity(ctx(Role.OWNER), { userId: manager.id, kind: "changes" });
    expect(changes.entries.map((e) => e.kind)).toEqual(["change"]);
    const views = await listActivity(ctx(Role.OWNER), { userId: manager.id, kind: "views" });
    expect(views.entries.map((e) => e.kind)).toEqual(["view"]);
  });

  it("never shows another organization's people", async () => {
    const all = await listActivity(ctx(Role.OWNER), {});
    expect(all.entries.some((e) => e.userId === outsider.id)).toBe(false);
    await expect(listActivity(ctx(Role.OWNER), { userId: outsider.id })).rejects.toMatchObject({ status: 404 });
  });
});
