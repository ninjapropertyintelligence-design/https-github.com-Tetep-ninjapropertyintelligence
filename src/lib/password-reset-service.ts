import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { appBaseUrl, sendEmail } from "@/lib/email";
import { passwordChangedEmail, passwordResetEmail } from "@/lib/email-templates";
import {
  PASSWORD_RESET_REQUEST_RULE,
  PASSWORD_RESET_SUBMIT_RULE,
  checkRateLimit,
  resetRateLimit,
} from "@/lib/rate-limit";

/**
 * Forgot password.
 *
 * The rules this file exists to keep:
 *
 * 1. A request never says whether the email has an account. The response is
 *    the same, and takes the same time, either way, so the form cannot be
 *    used to find out who is a customer.
 * 2. A link works once, for an hour, and only the newest one works. Only a
 *    hash of it is stored.
 * 3. A completed reset signs out every existing session (via
 *    `passwordChangedAt`), so whoever had the old password loses access too.
 * 4. Resetting a password does not get round a second factor: MFA is still
 *    asked for at the next sign-in.
 */

export const RESET_TOKEN_TTL_MINUTES = 60;
export const MIN_PASSWORD_LENGTH = 10;
/** bcrypt ignores everything past 72 bytes; accepting more would be a silent lie. */
export const MAX_PASSWORD_BYTES = 72;
const BCRYPT_COST = 10;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Returns the problem with a proposed password, or null if it is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return `Use at most ${MAX_PASSWORD_BYTES} characters.`;
  }
  if (password.trim().length === 0) return "A password cannot be only spaces.";
  return null;
}

async function organizationIdFor(userId: string): Promise<string | null> {
  const membership = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * The part of a reset request that may answer the caller: the rate limit.
 * Checked before any lookup, so hitting it reveals nothing about the account.
 */
export function assertResetRequestAllowed(email: string, ip: string | null): void {
  const keys = [`pwreset:email:${normalizeEmail(email)}`, ...(ip ? [`pwreset:ip:${ip}`] : [])];
  if (keys.some((key) => !checkRateLimit(key, PASSWORD_RESET_REQUEST_RULE).allowed)) {
    throw new ApiError(429, "Too many reset requests. Wait a while and try again.");
  }
}

/**
 * Issues a reset link, if the address has an active account. Resolves the
 * same way either way. The route runs this AFTER responding, so the response
 * cannot be timed to tell an account that got an email from one that did not.
 */
export async function requestPasswordReset(email: string, ip: string | null): Promise<void> {
  const normalizedEmail = normalizeEmail(email);

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !user.isActive) return;

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await prisma.$transaction([
    // Only the newest link works. An older email left in an inbox is dead.
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
        requestedIp: ip,
      },
    }),
  ]);

  await writeAuditLog({
    organizationId: await organizationIdFor(user.id),
    actorUserId: user.id,
    action: "password.reset_requested",
    entityType: "User",
    entityId: user.id,
    metadata: { ip },
  }).catch(() => {});

  await sendEmail(
    passwordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl: `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`,
      expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
    }),
  );
}

/** Whether a token is still redeemable, for the reset page to say so up front. */
export async function isResetTokenValid(token: string): Promise<boolean> {
  if (!token) return false;
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { isActive: true } } },
  });
  return !!row && row.usedAt === null && row.expiresAt > new Date() && row.user.isActive;
}

/** Redeems a token and sets the new password. */
export async function resetPassword(token: string, newPassword: string, ip: string | null): Promise<void> {
  if (ip && !checkRateLimit(`pwreset-submit:ip:${ip}`, PASSWORD_RESET_SUBMIT_RULE).allowed) {
    throw new ApiError(429, "Too many attempts. Wait a few minutes and try again.");
  }

  const problem = passwordProblem(newPassword);
  if (problem) throw new ApiError(400, problem);

  const invalid = new ApiError(400, "This reset link is invalid or has expired. Request a new one.");
  if (!token) throw invalid;

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!row || row.usedAt !== null || row.expiresAt <= new Date() || !row.user.isActive) throw invalid;

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const now = new Date();

  // Claim the token in the same statement that checks it is unclaimed, so two
  // submissions of one link cannot both succeed.
  const claimed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (count === 0) return false;
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, passwordChangedAt: now },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: row.userId, usedAt: null },
      data: { usedAt: now },
    });
    return true;
  });
  if (!claimed) throw invalid;

  // Someone who just proved they own the inbox should not stay locked out by
  // the failed sign-ins that probably sent them here.
  resetRateLimit(`login:email:${row.user.email}`);

  await writeAuditLog({
    organizationId: await organizationIdFor(row.userId),
    actorUserId: row.userId,
    action: "password.reset_completed",
    entityType: "User",
    entityId: row.userId,
    metadata: { ip },
  }).catch(() => {});

  await sendEmail(passwordChangedEmail({ to: row.user.email, name: row.user.name, loginUrl: `${appBaseUrl()}/login` }));
}
