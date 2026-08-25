import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { Role } from "@/generated/prisma/client";
import {
  endImpersonation,
  listSupportAccessHistory,
  resolveImpersonation,
  setSupportAccessPolicy,
  startImpersonation,
} from "@/lib/impersonation";
import { PLATFORM_ONLY_PERMISSIONS, permissionsForRole } from "@/lib/permissions";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Admin impersonation (spec §45) against real Postgres. The spec lists five
 * requirements; each has at least one case here, plus the two properties
 * that make it safe to ship: sessions expire, and a revoked session stops
 * being honoured immediately rather than at the next token refresh.
 */
const suffix = `imp${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let org: { id: string; name: string };
let otherOrg: { id: string };
let admin: { id: string };
let notAdmin: { id: string };
let orgOwner: { id: string };

const REASON = "Ticket #4821 — investigating a missing assessment";

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `Imp Org ${suffix}`, slug: `imp-org-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `Imp Other ${suffix}`, slug: `imp-other-${suffix}` } });

  admin = await prisma.user.create({
    data: { email: `${suffix}-admin@example.com`, passwordHash: "x", name: "Support Person", isPlatformAdmin: true },
  });
  notAdmin = await prisma.user.create({
    data: { email: `${suffix}-plain@example.com`, passwordHash: "x", name: "Plain User" },
  });
  orgOwner = await prisma.user.create({
    data: { email: `${suffix}-owner@example.com`, passwordHash: "x", name: "Customer Owner" },
  });
  await prisma.membership.create({ data: { userId: orgOwner.id, organizationId: org.id, role: Role.OWNER } });
});

beforeEach(async () => {
  await prisma.impersonationSession.deleteMany({ where: { adminUserId: admin.id } });
  await prisma.organization.update({ where: { id: org.id }, data: { allowSupportAccess: true } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: suffix } } });
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
});

function ownerCtx(): SessionContext {
  return {
    userId: orgOwner.id,
    userName: "Customer Owner",
    userEmail: `${suffix}-owner@example.com`,
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: org.name,
    membershipId: "irrelevant",
    role: Role.OWNER,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

describe("1. authorized support role", () => {
  it("only PLATFORM_ADMIN holds canImpersonate — no customer role does, however senior", () => {
    expect(permissionsForRole(Role.PLATFORM_ADMIN)).toContain("canImpersonate");
    for (const role of Object.values(Role)) {
      if (role === Role.PLATFORM_ADMIN) continue;
      // Regression: OWNER's set was built as "everything except
      // canAccessPlatformAdmin", so adding canImpersonate silently granted
      // every customer Owner the ability to impersonate.
      for (const platformOnly of PLATFORM_ONLY_PERMISSIONS) {
        expect(permissionsForRole(role)).not.toContain(platformOnly);
      }
    }
  });

  it("refuses a user who is not a platform admin, even with a valid reason", async () => {
    await expect(
      startImpersonation({ adminUserId: notAdmin.id, organizationId: org.id, reason: REASON }),
    ).rejects.toThrow(/authorized support role/);
  });
});

describe("2. logged, and 3. reason recorded", () => {
  it("records the session and writes it to the CUSTOMER's audit log", async () => {
    const session = await startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason: REASON });

    const row = await prisma.impersonationSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(row.reason).toBe(REASON);
    expect(row.organizationId).toBe(org.id);
    expect(row.endedAt).toBeNull();

    // Scoped to the customer's org, not the platform — the customer has to
    // be able to see it, which is the whole point of logging it.
    const log = await prisma.auditLog.findFirst({
      where: { organizationId: org.id, action: "admin.impersonation_started" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).toBeTruthy();
    expect((log?.metadata as { reason?: string })?.reason).toBe(REASON);
  });

  it("requires a non-trivial reason", async () => {
    for (const reason of ["", "   ", "help", "ticket"]) {
      await expect(
        startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason }),
      ).rejects.toThrow(/reason of at least/);
    }
    expect(await prisma.impersonationSession.count({ where: { adminUserId: admin.id } })).toBe(0);
  });

  it("the customer can read the history of who opened their account", async () => {
    await startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason: REASON });
    const history = await listSupportAccessHistory(ownerCtx());

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ adminName: "Support Person", reason: REASON, active: true });
  });

  it("history is scoped to the caller's own organization", async () => {
    await startImpersonation({ adminUserId: admin.id, organizationId: otherOrg.id, reason: REASON });
    // A session against a different org must not appear in this org's history.
    expect(await listSupportAccessHistory(ownerCtx())).toHaveLength(0);
  });

  it("ending the session is logged too, with its duration", async () => {
    const session = await startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason: REASON });
    await endImpersonation({ sessionId: session.sessionId, adminUserId: admin.id });

    const row = await prisma.impersonationSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(row.endedAt).toBeInstanceOf(Date);
    expect(row.endedReason).toBe("manual");

    const log = await prisma.auditLog.findFirst({
      where: { organizationId: org.id, action: "admin.impersonation_ended" },
    });
    expect(log).toBeTruthy();
  });
});

describe("5. customer policy can disable it", () => {
  it("refuses to start when the customer has support access off", async () => {
    await setSupportAccessPolicy({ organizationId: org.id, actorUserId: orgOwner.id, allowSupportAccess: false });
    await expect(
      startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason: REASON }),
    ).rejects.toThrow(/disabled platform support access/);
  });

  it("turning it off ends a session already in progress — not just future ones", async () => {
    const session = await startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason: REASON });
    expect(await resolveImpersonation(session.sessionId, admin.id)).not.toBeNull();

    const result = await setSupportAccessPolicy({
      organizationId: org.id,
      actorUserId: orgOwner.id,
      allowSupportAccess: false,
    });
    expect(result.endedSessions).toBe(1);

    // The next request must not be honoured. This is why authorization is
    // read from the row rather than baked into a token.
    expect(await resolveImpersonation(session.sessionId, admin.id)).toBeNull();
  });
});

describe("session resolution", () => {
  it("resolves an active session into the customer's org", async () => {
    const session = await startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason: REASON });
    const resolved = await resolveImpersonation(session.sessionId, admin.id);
    expect(resolved).toMatchObject({ organizationId: org.id, reason: REASON, adminUserId: admin.id });
  });

  it("a cookie from one admin cannot activate another admin's session", async () => {
    const session = await startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason: REASON });
    const otherAdmin = await prisma.user.create({
      data: { email: `${suffix}-admin2@example.com`, passwordHash: "x", name: "Other Support", isPlatformAdmin: true },
    });
    expect(await resolveImpersonation(session.sessionId, otherAdmin.id)).toBeNull();
  });

  it("an expired session is not honoured, and is closed out as expired", async () => {
    const session = await startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason: REASON });
    await prisma.impersonationSession.update({
      where: { id: session.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await resolveImpersonation(session.sessionId, admin.id)).toBeNull();
    const row = await prisma.impersonationSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(row.endedReason).toBe("expired");
  });

  it("caps the duration — a caller cannot ask for a longer session than the maximum", async () => {
    const session = await startImpersonation({
      adminUserId: admin.id,
      organizationId: org.id,
      reason: REASON,
      durationMinutes: 60 * 24 * 30,
    });
    const minutes = (session.expiresAt.getTime() - session.startedAt.getTime()) / 60_000;
    expect(minutes).toBeLessThanOrEqual(60);
  });

  it("stops being honoured if support loses their platform-admin role mid-session", async () => {
    const session = await startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason: REASON });
    await prisma.user.update({ where: { id: admin.id }, data: { isPlatformAdmin: false } });
    try {
      expect(await resolveImpersonation(session.sessionId, admin.id)).toBeNull();
    } finally {
      await prisma.user.update({ where: { id: admin.id }, data: { isPlatformAdmin: true } });
    }
  });

  it("returns null rather than throwing for a missing or bogus session id", async () => {
    expect(await resolveImpersonation(undefined, admin.id)).toBeNull();
    expect(await resolveImpersonation("does-not-exist", admin.id)).toBeNull();
  });

  it("starting a second session ends the first, so no session is left unaccounted for", async () => {
    const first = await startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason: REASON });
    const second = await startImpersonation({ adminUserId: admin.id, organizationId: otherOrg.id, reason: REASON });

    expect(await resolveImpersonation(first.sessionId, admin.id)).toBeNull();
    expect(await resolveImpersonation(second.sessionId, admin.id)).not.toBeNull();
  });
});

describe("ending", () => {
  it("refuses to end a session belonging to someone else", async () => {
    const session = await startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason: REASON });
    await expect(endImpersonation({ sessionId: session.sessionId, adminUserId: notAdmin.id })).rejects.toThrow(ApiError);
    expect(await resolveImpersonation(session.sessionId, admin.id)).not.toBeNull();
  });

  it("is idempotent", async () => {
    const session = await startImpersonation({ adminUserId: admin.id, organizationId: org.id, reason: REASON });
    await endImpersonation({ sessionId: session.sessionId, adminUserId: admin.id });
    await expect(endImpersonation({ sessionId: session.sessionId, adminUserId: admin.id })).resolves.toBeUndefined();
  });
});
