import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { decryptSecret, totp } from "@/lib/mfa";
import {
  activateMfa,
  beginMfaEnrollment,
  disableMfa,
  getMfaStatus,
  regenerateRecoveryCodes,
  setOrganizationMfaPolicy,
  verifyMfaCode,
} from "@/lib/mfa-service";

/**
 * MFA against real Postgres (spec §43). These cover the properties that
 * actually matter for a second factor — the secret is never readable as
 * stored, recovery codes are single-use, disabling requires the factor
 * itself — rather than just that the happy path returns 200.
 */
const suffix = `mfa${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let org: { id: string };
let user: { id: string; email: string };

/** Reads the stored ciphertext and produces a code the way an app would. */
async function currentCodeFor(userId: string): Promise<string> {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaSecret: true } });
  return totp(decryptSecret(row.mfaSecret!));
}

async function enrollAndActivate(userId: string, email: string) {
  await beginMfaEnrollment({ userId, userEmail: email });
  return activateMfa({ userId, organizationId: org.id, code: await currentCodeFor(userId) });
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `MFA Org ${suffix}`, slug: `mfa-org-${suffix}` } });
});

beforeEach(async () => {
  // A fresh user per case: MFA state is per-user and leaking it between
  // cases would let a passing test depend on the order it ran in.
  const created = await prisma.user.create({
    data: { email: `${suffix}-${Math.random().toString(36).slice(2, 10)}@example.com`, passwordHash: "x", name: "MFA User" },
  });
  user = { id: created.id, email: created.email };
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: suffix } } });
  await prisma.organization.delete({ where: { id: org.id } });
});

describe("enrollment", () => {
  it("starts disabled", async () => {
    const status = await getMfaStatus(user.id, org.id);
    expect(status.state).toBe("DISABLED");
    expect(status.unusedRecoveryCodes).toBe(0);
  });

  it("beginning enrollment stores an encrypted secret, never the plaintext", async () => {
    const { secret } = await beginMfaEnrollment({ userId: user.id, userEmail: user.email });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { mfaSecret: true } });
    expect(row.mfaSecret).toBeTruthy();
    // The single property that makes at-rest encryption worth having: a
    // database dump does not contain the shared secret.
    expect(row.mfaSecret).not.toContain(secret);
    expect(decryptSecret(row.mfaSecret!)).toBe(secret);
  });

  it("is PENDING — not enabled — until a code is proven", async () => {
    await beginMfaEnrollment({ userId: user.id, userEmail: user.email });
    const status = await getMfaStatus(user.id, org.id);
    expect(status.state).toBe("PENDING");
    // Nothing is enforced yet, so a user who scanned a code and stopped is
    // not locked out.
    expect(status.enabledAt).toBeNull();
  });

  it("rejects a wrong code and stays PENDING", async () => {
    await beginMfaEnrollment({ userId: user.id, userEmail: user.email });
    await expect(activateMfa({ userId: user.id, organizationId: org.id, code: "000000" })).rejects.toThrow(ApiError);
    expect((await getMfaStatus(user.id, org.id)).state).toBe("PENDING");
  });

  it("refuses a code before enrollment has started", async () => {
    await expect(activateMfa({ userId: user.id, organizationId: org.id, code: "123456" })).rejects.toThrow(
      /Start enrollment/,
    );
  });

  it("activating with a valid code enables MFA and issues 10 recovery codes", async () => {
    const { recoveryCodes } = await enrollAndActivate(user.id, user.email);
    expect(recoveryCodes).toHaveLength(10);

    const status = await getMfaStatus(user.id, org.id);
    expect(status.state).toBe("ENABLED");
    expect(status.enabledAt).toBeInstanceOf(Date);
    expect(status.unusedRecoveryCodes).toBe(10);
  });

  it("stores recovery codes hashed — the plaintext is not in the database", async () => {
    const { recoveryCodes } = await enrollAndActivate(user.id, user.email);
    const stored = await prisma.mfaRecoveryCode.findMany({ where: { userId: user.id }, select: { codeHash: true } });
    const hashes = stored.map((r) => r.codeHash);
    for (const code of recoveryCodes) {
      expect(hashes).not.toContain(code);
      expect(hashes).not.toContain(code.replace("-", ""));
    }
  });

  it("refuses to re-enroll while enabled — silently rotating a working factor locks people out", async () => {
    await enrollAndActivate(user.id, user.email);
    await expect(beginMfaEnrollment({ userId: user.id, userEmail: user.email })).rejects.toThrow(/already enabled/);
  });

  it("writes an audit log entry when enabled (spec §44)", async () => {
    await enrollAndActivate(user.id, user.email);
    const log = await prisma.auditLog.findFirst({ where: { actorUserId: user.id, action: "mfa.enabled" } });
    expect(log).toBeTruthy();
    expect(log?.organizationId).toBe(org.id);
  });
});

describe("verification", () => {
  it("accepts a current TOTP code", async () => {
    await enrollAndActivate(user.id, user.email);
    const result = await verifyMfaCode({ userId: user.id, code: await currentCodeFor(user.id) });
    expect(result).toEqual({ ok: true, usedRecoveryCode: false });
  });

  it("rejects a wrong code", async () => {
    await enrollAndActivate(user.id, user.email);
    const code = await currentCodeFor(user.id);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await verifyMfaCode({ userId: user.id, code: wrong })).toEqual({ ok: false, usedRecoveryCode: false });
  });

  it("accepts a recovery code, and only once", async () => {
    const { recoveryCodes } = await enrollAndActivate(user.id, user.email);
    const code = recoveryCodes[0];

    expect(await verifyMfaCode({ userId: user.id, code, organizationId: org.id })).toEqual({
      ok: true,
      usedRecoveryCode: true,
    });
    // Replaying it must fail — this is the whole point of single-use.
    expect(await verifyMfaCode({ userId: user.id, code, organizationId: org.id })).toEqual({
      ok: false,
      usedRecoveryCode: false,
    });
    expect((await getMfaStatus(user.id, org.id)).unusedRecoveryCodes).toBe(9);
  });

  it("two concurrent uses of the same recovery code consume it exactly once", async () => {
    const { recoveryCodes } = await enrollAndActivate(user.id, user.email);
    const code = recoveryCodes[0];

    const results = await Promise.all([
      verifyMfaCode({ userId: user.id, code, organizationId: org.id }),
      verifyMfaCode({ userId: user.id, code, organizationId: org.id }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await getMfaStatus(user.id, org.id)).unusedRecoveryCodes).toBe(9);
  });

  it("a recovery code from one user never works for another", async () => {
    const { recoveryCodes } = await enrollAndActivate(user.id, user.email);
    const other = await prisma.user.create({
      data: { email: `${suffix}-other-${Math.random().toString(36).slice(2, 8)}@example.com`, passwordHash: "x", name: "Other" },
    });
    await enrollAndActivate(other.id, other.email);

    expect(await verifyMfaCode({ userId: other.id, code: recoveryCodes[0] })).toEqual({
      ok: false,
      usedRecoveryCode: false,
    });
  });

  it("verification fails for a user who never enabled MFA, rather than passing vacuously", async () => {
    expect(await verifyMfaCode({ userId: user.id, code: "123456" })).toEqual({ ok: false, usedRecoveryCode: false });
  });
});

describe("recovery code regeneration", () => {
  it("requires a valid code and invalidates the previous set", async () => {
    const { recoveryCodes: original } = await enrollAndActivate(user.id, user.email);

    await expect(
      regenerateRecoveryCodes({ userId: user.id, organizationId: org.id, code: "000000" }),
    ).rejects.toThrow(/not valid/);

    const { recoveryCodes: fresh } = await regenerateRecoveryCodes({
      userId: user.id,
      organizationId: org.id,
      code: await currentCodeFor(user.id),
    });

    expect(fresh).toHaveLength(10);
    expect(fresh).not.toEqual(original);
    // An old code must stop working the moment a new set is issued.
    expect(await verifyMfaCode({ userId: user.id, code: original[0] })).toEqual({ ok: false, usedRecoveryCode: false });
    expect(await verifyMfaCode({ userId: user.id, code: fresh[0] })).toEqual({ ok: true, usedRecoveryCode: true });
  });
});

describe("disabling", () => {
  it("requires the second factor to turn off the second factor", async () => {
    await enrollAndActivate(user.id, user.email);
    await expect(disableMfa({ userId: user.id, organizationId: org.id, code: "000000" })).rejects.toThrow(/not valid/);
    expect((await getMfaStatus(user.id, org.id)).state).toBe("ENABLED");
  });

  it("clears the secret and every recovery code", async () => {
    await enrollAndActivate(user.id, user.email);
    await disableMfa({ userId: user.id, organizationId: org.id, code: await currentCodeFor(user.id) });

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { mfaSecret: true, mfaEnabledAt: true },
    });
    expect(row.mfaSecret).toBeNull();
    expect(row.mfaEnabledAt).toBeNull();
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    expect((await getMfaStatus(user.id, org.id)).state).toBe("DISABLED");
  });

  it("is refused while the organization requires MFA", async () => {
    await enrollAndActivate(user.id, user.email);
    await setOrganizationMfaPolicy({ organizationId: org.id, actorUserId: user.id, requireMfa: true });
    try {
      await expect(
        disableMfa({ userId: user.id, organizationId: org.id, code: await currentCodeFor(user.id) }),
      ).rejects.toThrow(/organization requires/);
    } finally {
      await setOrganizationMfaPolicy({ organizationId: org.id, actorUserId: user.id, requireMfa: false });
    }
  });
});

describe("organization policy", () => {
  it("refuses to require MFA when the admin turning it on is not enrolled", async () => {
    // Regression: an unenrolled admin who enabled the policy was then
    // refused by that same policy on every request — including the request
    // to turn it back off. The organization had no way out. Caught by
    // driving the real app, not by any unit test.
    await expect(
      setOrganizationMfaPolicy({ organizationId: org.id, actorUserId: user.id, requireMfa: true }),
    ).rejects.toThrow(/Enrol your own account/);

    const org_ = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { requireMfa: true } });
    expect(org_.requireMfa).toBe(false);
  });

  it("an enrolled admin can always turn the policy back off — the door is not one-way", async () => {
    await enrollAndActivate(user.id, user.email);
    await setOrganizationMfaPolicy({ organizationId: org.id, actorUserId: user.id, requireMfa: true });
    // Disabling has no enrollment precondition, so recovery is always possible.
    const result = await setOrganizationMfaPolicy({ organizationId: org.id, actorUserId: user.id, requireMfa: false });
    expect(result.requireMfa).toBe(false);
  });

  it("reports how many members the policy would block before it is applied", async () => {
    await enrollAndActivate(user.id, user.email);
    const result = await setOrganizationMfaPolicy({ organizationId: org.id, actorUserId: user.id, requireMfa: true });
    expect(result.requireMfa).toBe(true);
    // Counted before the change, and this org accumulates a user per case,
    // so earlier cases' unenrolled users must show up here.
    expect(result.unenrolledMembers).toBeGreaterThanOrEqual(1);

    expect((await getMfaStatus(user.id, org.id)).requiredByPolicy).toBe(true);
    await setOrganizationMfaPolicy({ organizationId: org.id, actorUserId: user.id, requireMfa: false });
    expect((await getMfaStatus(user.id, org.id)).requiredByPolicy).toBe(false);
  });

  it("audits the policy change (spec §44 permission change)", async () => {
    await enrollAndActivate(user.id, user.email);
    await setOrganizationMfaPolicy({ organizationId: org.id, actorUserId: user.id, requireMfa: true });
    await setOrganizationMfaPolicy({ organizationId: org.id, actorUserId: user.id, requireMfa: false });
    const logs = await prisma.auditLog.findMany({
      where: { organizationId: org.id, action: "org.mfa_policy_changed" },
      orderBy: { createdAt: "desc" },
      take: 2,
    });
    expect(logs.length).toBe(2);
  });

  it("does not leak policy across organizations", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: `MFA Other ${suffix}`, slug: `mfa-other-${suffix}-${Math.random().toString(36).slice(2, 6)}` },
    });
    try {
      await enrollAndActivate(user.id, user.email);
      await setOrganizationMfaPolicy({ organizationId: otherOrg.id, actorUserId: user.id, requireMfa: true });
      expect((await getMfaStatus(user.id, org.id)).requiredByPolicy).toBe(false);
      expect((await getMfaStatus(user.id, otherOrg.id)).requiredByPolicy).toBe(true);
    } finally {
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });
});
