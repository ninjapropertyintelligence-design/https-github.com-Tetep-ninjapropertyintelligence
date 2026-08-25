import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import {
  MfaNotConfiguredError,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  isMfaConfigured,
  otpauthUri,
  verifyTotp,
} from "@/lib/mfa";

/**
 * MFA enrollment/verification state machine (spec §43).
 *
 *   none  --begin-->  pending (secret stored, mfaEnabledAt null)
 *   pending --activate(valid code)--> enabled (+ recovery codes issued)
 *   enabled --disable(valid code or recovery code)--> none
 *
 * The pending state matters: a user who scans a QR code but never proves
 * they can generate a code must not be locked out, so nothing is enforced
 * until activation succeeds.
 *
 * No next-auth / next/headers imports here, deliberately — same reason as
 * lib/tenant-scope.ts: this is directly testable against Postgres.
 */

const ISSUER = "Property Intelligence";

export type MfaState = "UNAVAILABLE" | "DISABLED" | "PENDING" | "ENABLED";

export interface MfaStatus {
  state: MfaState;
  enabledAt: Date | null;
  lastVerifiedAt: Date | null;
  unusedRecoveryCodes: number;
  /** True when the user's active org requires MFA of every member. */
  requiredByPolicy: boolean;
}

export async function getMfaStatus(userId: string, organizationId?: string | null): Promise<MfaStatus> {
  const [user, unusedRecoveryCodes, org] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabledAt: true, mfaLastVerifiedAt: true },
    }),
    prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
    organizationId
      ? prisma.organization.findUnique({ where: { id: organizationId }, select: { requireMfa: true } })
      : Promise.resolve(null),
  ]);
  if (!user) throw new ApiError(404, "User not found");

  let state: MfaState;
  if (!isMfaConfigured()) state = "UNAVAILABLE";
  else if (user.mfaEnabledAt) state = "ENABLED";
  else if (user.mfaSecret) state = "PENDING";
  else state = "DISABLED";

  return {
    state,
    enabledAt: user.mfaEnabledAt,
    lastVerifiedAt: user.mfaLastVerifiedAt,
    unusedRecoveryCodes,
    requiredByPolicy: org?.requireMfa ?? false,
  };
}

/**
 * Starts enrollment: mints a secret and returns it once, in the two forms an
 * authenticator accepts. Re-running this before activation replaces the
 * pending secret (the user may have lost the QR code); it refuses once MFA
 * is active, because silently rotating a working second factor is how people
 * get locked out.
 */
export async function beginMfaEnrollment(params: { userId: string; userEmail: string }) {
  if (!isMfaConfigured()) throw new MfaNotConfiguredError();

  const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { mfaEnabledAt: true } });
  if (!user) throw new ApiError(404, "User not found");
  if (user.mfaEnabledAt) {
    throw new ApiError(409, "Multi-factor authentication is already enabled. Disable it first to re-enroll.");
  }

  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: params.userId },
    data: { mfaSecret: encryptSecret(secret) },
  });

  return {
    secret,
    otpauthUri: otpauthUri({ secret, accountEmail: params.userEmail, issuer: ISSUER }),
  };
}

/**
 * Completes enrollment by proving the user can generate a code. Returns the
 * recovery codes in plaintext exactly once — they are stored hashed and are
 * unrecoverable afterwards.
 */
export async function activateMfa(params: {
  userId: string;
  organizationId?: string | null;
  code: string;
}): Promise<{ recoveryCodes: string[] }> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { mfaSecret: true, mfaEnabledAt: true },
  });
  if (!user) throw new ApiError(404, "User not found");
  if (user.mfaEnabledAt) throw new ApiError(409, "Multi-factor authentication is already enabled");
  if (!user.mfaSecret) throw new ApiError(400, "Start enrollment before submitting a code");

  if (verifyTotp(decryptSecret(user.mfaSecret), params.code) === null) {
    throw new ApiError(400, "That code is not valid. Check your authenticator app's clock and try again.");
  }

  const codes = generateRecoveryCodes();
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: params.userId },
      data: { mfaEnabledAt: now, mfaLastVerifiedAt: now },
    }),
    // Replace any codes left over from a previous enrollment.
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: params.userId } }),
    prisma.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({ userId: params.userId, codeHash: hashRecoveryCode(code) })),
    }),
  ]);

  await writeAuditLog({
    organizationId: params.organizationId ?? null,
    actorUserId: params.userId,
    action: "mfa.enabled",
    entityType: "User",
    entityId: params.userId,
    metadata: { recoveryCodesIssued: codes.length },
  });

  return { recoveryCodes: codes };
}

/**
 * Verifies a TOTP code or an unused recovery code. Used both at login and
 * to authorize sensitive MFA changes. Recovery codes are single-use and are
 * marked used inside a conditional update, so two concurrent requests
 * cannot both consume the same code.
 */
export async function verifyMfaCode(params: {
  userId: string;
  code: string;
  organizationId?: string | null;
}): Promise<{ ok: boolean; usedRecoveryCode: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { mfaSecret: true, mfaEnabledAt: true },
  });
  if (!user?.mfaSecret || !user.mfaEnabledAt) return { ok: false, usedRecoveryCode: false };

  if (verifyTotp(decryptSecret(user.mfaSecret), params.code) !== null) {
    await prisma.user.update({ where: { id: params.userId }, data: { mfaLastVerifiedAt: new Date() } });
    return { ok: true, usedRecoveryCode: false };
  }

  const consumed = await prisma.mfaRecoveryCode.updateMany({
    where: { userId: params.userId, codeHash: hashRecoveryCode(params.code), usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count === 1) {
    await prisma.user.update({ where: { id: params.userId }, data: { mfaLastVerifiedAt: new Date() } });
    const remaining = await prisma.mfaRecoveryCode.count({ where: { userId: params.userId, usedAt: null } });
    await writeAuditLog({
      organizationId: params.organizationId ?? null,
      actorUserId: params.userId,
      action: "mfa.recovery_code_used",
      entityType: "User",
      entityId: params.userId,
      metadata: { remainingRecoveryCodes: remaining },
    });
    return { ok: true, usedRecoveryCode: true };
  }

  return { ok: false, usedRecoveryCode: false };
}

/** Turning off a second factor must itself require the second factor. */
export async function disableMfa(params: {
  userId: string;
  organizationId?: string | null;
  code: string;
}): Promise<void> {
  const status = await getMfaStatus(params.userId, params.organizationId);
  if (status.state !== "ENABLED") throw new ApiError(400, "Multi-factor authentication is not enabled");
  if (status.requiredByPolicy) {
    throw new ApiError(403, "Your organization requires multi-factor authentication. It cannot be disabled.");
  }

  const result = await verifyMfaCode(params);
  if (!result.ok) throw new ApiError(400, "That code is not valid");

  await prisma.$transaction([
    prisma.user.update({
      where: { id: params.userId },
      data: { mfaSecret: null, mfaEnabledAt: null, mfaLastVerifiedAt: null },
    }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: params.userId } }),
  ]);

  await writeAuditLog({
    organizationId: params.organizationId ?? null,
    actorUserId: params.userId,
    action: "mfa.disabled",
    entityType: "User",
    entityId: params.userId,
    metadata: { viaRecoveryCode: result.usedRecoveryCode },
  });
}

/** Issues a fresh set, invalidating the old one. Requires a valid code. */
export async function regenerateRecoveryCodes(params: {
  userId: string;
  organizationId?: string | null;
  code: string;
}): Promise<{ recoveryCodes: string[] }> {
  const status = await getMfaStatus(params.userId, params.organizationId);
  if (status.state !== "ENABLED") throw new ApiError(400, "Multi-factor authentication is not enabled");

  const result = await verifyMfaCode(params);
  if (!result.ok) throw new ApiError(400, "That code is not valid");

  const codes = generateRecoveryCodes();
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: params.userId } }),
    prisma.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({ userId: params.userId, codeHash: hashRecoveryCode(code) })),
    }),
  ]);

  await writeAuditLog({
    organizationId: params.organizationId ?? null,
    actorUserId: params.userId,
    action: "mfa.recovery_codes_regenerated",
    entityType: "User",
    entityId: params.userId,
    metadata: { issued: codes.length },
  });

  return { recoveryCodes: codes };
}

/**
 * Org-wide policy toggle (spec §43). Turning it ON is checked against
 * reality first: enforcing a policy that instantly locks out most of the
 * team is worse than refusing, so the caller gets told who is unenrolled.
 *
 * The actor must already be enrolled to switch it on. That is not a UI
 * nicety — it is what stops the policy being a one-way door. Every request
 * from an unenrolled member of a requiring org is refused, *including* the
 * request to turn the policy back off, so an unenrolled admin who enabled
 * it could never undo it and would lock the whole organization out
 * permanently. Requiring the admin to be enrolled guarantees at least one
 * person can always sign in and reverse it.
 *
 * (Losing that last enrolled admin's device and recovery codes is what
 * platform-admin support access exists for — spec §45.)
 */
export async function setOrganizationMfaPolicy(params: {
  organizationId: string;
  actorUserId: string;
  requireMfa: boolean;
}): Promise<{ requireMfa: boolean; unenrolledMembers: number }> {
  const unenrolledMembers = await prisma.membership.count({
    where: { organizationId: params.organizationId, user: { mfaEnabledAt: null, isActive: true } },
  });

  if (params.requireMfa) {
    const actor = await prisma.user.findUnique({
      where: { id: params.actorUserId },
      select: { mfaEnabledAt: true },
    });
    if (!actor?.mfaEnabledAt) {
      throw new ApiError(
        400,
        "Enrol your own account in multi-factor authentication before requiring it. Otherwise this setting " +
          "would lock you out of the organization with no way to turn it off.",
      );
    }
  }

  await prisma.organization.update({
    where: { id: params.organizationId },
    data: { requireMfa: params.requireMfa },
  });

  await writeAuditLog({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: "org.mfa_policy_changed",
    entityType: "Organization",
    entityId: params.organizationId,
    metadata: { requireMfa: params.requireMfa, unenrolledMembersAtChange: unenrolledMembers },
  });

  return { requireMfa: params.requireMfa, unenrolledMembers };
}
