import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { SessionContext } from "@/lib/tenant-scope";

/**
 * Platform support viewing a customer's account (spec §45). All five of the
 * spec's requirements are enforced here or in the code this drives:
 *
 *   1. Authorized support role  -> `canImpersonate`, granted to PLATFORM_ADMIN only
 *   2. Log the impersonation    -> ImpersonationSession row + audit log, both org-scoped
 *   3. Record reason            -> required, non-trivial, stored and shown to the customer
 *   4. Visible indicator        -> ImpersonationBanner, rendered by the app layout
 *   5. Customer policy off-switch -> Organization.allowSupportAccess
 *
 * Two properties beyond the spec, because the spec's list is a floor:
 *   - Sessions expire. A forgotten one must not become standing cross-tenant
 *     access.
 *   - Impersonation is read-only. The session's role is VIEWER and
 *     `withApiHandler` refuses non-GET requests outright, so support can
 *     diagnose but cannot change a customer's data while wearing their face.
 *
 * No next-auth / next/headers imports — same reason as lib/tenant-scope.ts:
 * directly testable against Postgres.
 */

export const IMPERSONATION_COOKIE = "impersonationSessionId";

/** Sessions end on their own; support does not have to remember to stop. */
export const MAX_DURATION_MINUTES = 60;
const MIN_REASON_LENGTH = 10;

export interface ImpersonationContext {
  sessionId: string;
  adminUserId: string;
  adminName: string;
  adminEmail: string;
  organizationId: string;
  organizationName: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
}

/**
 * Starts a session. Returns the id the caller must place in a cookie.
 * Refuses if the customer has support access switched off — checked here,
 * not only in the UI, so an API call cannot bypass the customer's policy.
 */
export async function startImpersonation(params: {
  adminUserId: string;
  organizationId: string;
  reason: string;
  durationMinutes?: number;
  ipAddress?: string | null;
}): Promise<ImpersonationContext> {
  const admin = await prisma.user.findUnique({
    where: { id: params.adminUserId },
    select: { id: true, name: true, email: true, isPlatformAdmin: true, isActive: true },
  });
  if (!admin?.isActive || !admin.isPlatformAdmin) {
    throw new ApiError(403, "Support impersonation requires an authorized support role");
  }

  const reason = params.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new ApiError(
      400,
      `A reason of at least ${MIN_REASON_LENGTH} characters is required. It is shown to the customer.`,
    );
  }

  const organization = await prisma.organization.findUnique({
    where: { id: params.organizationId },
    select: { id: true, name: true, allowSupportAccess: true },
  });
  if (!organization) throw new ApiError(404, "Organization not found");
  if (!organization.allowSupportAccess) {
    throw new ApiError(403, "This organization has disabled platform support access");
  }

  // One active session per admin: a second one would leave the first
  // running and unaccounted for in the customer's history.
  await endActiveSessionsForAdmin(params.adminUserId, "manual");

  const durationMinutes = Math.min(params.durationMinutes ?? MAX_DURATION_MINUTES, MAX_DURATION_MINUTES);
  const session = await prisma.impersonationSession.create({
    data: {
      adminUserId: admin.id,
      organizationId: organization.id,
      reason,
      expiresAt: new Date(Date.now() + durationMinutes * 60_000),
      ipAddress: params.ipAddress ?? null,
    },
  });

  // Scoped to the customer's organization deliberately: the point of
  // logging impersonation is that the customer can see it happened.
  await writeAuditLog({
    organizationId: organization.id,
    actorUserId: admin.id,
    action: "admin.impersonation_started",
    entityType: "Organization",
    entityId: organization.id,
    metadata: { reason, expiresAt: session.expiresAt.toISOString(), durationMinutes },
  });

  return {
    sessionId: session.id,
    adminUserId: admin.id,
    adminName: admin.name,
    adminEmail: admin.email,
    organizationId: organization.id,
    organizationName: organization.name,
    reason,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
  };
}

/**
 * Resolves a cookie value into an active session, or null. Returning null
 * for every failure mode (expired, ended, revoked, wrong admin, missing) is
 * intentional: the caller then behaves exactly as if no impersonation were
 * in progress, which is the safe default.
 *
 * An expired or revoked session is closed out here rather than by a
 * background job, so the customer's history is accurate without one.
 */
export async function resolveImpersonation(
  sessionId: string | undefined,
  adminUserId: string,
): Promise<ImpersonationContext | null> {
  if (!sessionId) return null;

  const session = await prisma.impersonationSession.findUnique({
    where: { id: sessionId },
    include: {
      admin: { select: { id: true, name: true, email: true, isPlatformAdmin: true, isActive: true } },
      organization: { select: { id: true, name: true, allowSupportAccess: true } },
    },
  });

  if (!session || session.endedAt) return null;
  // A cookie from one admin must never activate another's session.
  if (session.adminUserId !== adminUserId) return null;
  // Support access revoked mid-session, or the admin's own access removed.
  if (!session.admin.isActive || !session.admin.isPlatformAdmin) {
    await closeSession(session.id, "revoked_by_customer");
    return null;
  }
  if (!session.organization.allowSupportAccess) {
    await closeSession(session.id, "revoked_by_customer");
    return null;
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    await closeSession(session.id, "expired");
    return null;
  }

  return {
    sessionId: session.id,
    adminUserId: session.admin.id,
    adminName: session.admin.name,
    adminEmail: session.admin.email,
    organizationId: session.organization.id,
    organizationName: session.organization.name,
    reason: session.reason,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
  };
}

/** Ends a session the admin owns. Idempotent. */
export async function endImpersonation(params: { sessionId: string; adminUserId: string }): Promise<void> {
  const session = await prisma.impersonationSession.findUnique({ where: { id: params.sessionId } });
  if (!session || session.adminUserId !== params.adminUserId) {
    throw new ApiError(404, "No such impersonation session");
  }
  if (session.endedAt) return;

  await closeSession(session.id, "manual");
  await writeAuditLog({
    organizationId: session.organizationId,
    actorUserId: session.adminUserId,
    action: "admin.impersonation_ended",
    entityType: "Organization",
    entityId: session.organizationId,
    metadata: { reason: session.reason, durationSeconds: Math.round((Date.now() - session.startedAt.getTime()) / 1000) },
  });
}

async function closeSession(id: string, endedReason: string) {
  await prisma.impersonationSession.updateMany({
    where: { id, endedAt: null },
    data: { endedAt: new Date(), endedReason },
  });
}

async function endActiveSessionsForAdmin(adminUserId: string, endedReason: string) {
  await prisma.impersonationSession.updateMany({
    where: { adminUserId, endedAt: null },
    data: { endedAt: new Date(), endedReason },
  });
}

/**
 * The customer's own view of who has been in their account (spec §45 — the
 * log is only meaningful if the customer can read it). Scoped by the
 * caller's organization, never by a client-supplied id.
 */
export async function listSupportAccessHistory(ctx: SessionContext, limit = 20) {
  const sessions = await prisma.impersonationSession.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { admin: { select: { name: true, email: true } } },
  });

  return sessions.map((s) => ({
    id: s.id,
    adminName: s.admin.name,
    adminEmail: s.admin.email,
    reason: s.reason,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    expiresAt: s.expiresAt,
    endedReason: s.endedReason,
    active: s.endedAt === null && s.expiresAt.getTime() > Date.now(),
  }));
}

/** Customer-controlled off-switch (spec §45, fifth requirement). */
export async function setSupportAccessPolicy(params: {
  organizationId: string;
  actorUserId: string;
  allowSupportAccess: boolean;
}): Promise<{ allowSupportAccess: boolean; endedSessions: number }> {
  await prisma.organization.update({
    where: { id: params.organizationId },
    data: { allowSupportAccess: params.allowSupportAccess },
  });

  // Turning it off must stop sessions already running, not merely prevent
  // new ones — otherwise the switch does nothing about the case that
  // prompted flipping it.
  let endedSessions = 0;
  if (!params.allowSupportAccess) {
    const result = await prisma.impersonationSession.updateMany({
      where: { organizationId: params.organizationId, endedAt: null },
      data: { endedAt: new Date(), endedReason: "revoked_by_customer" },
    });
    endedSessions = result.count;
  }

  await writeAuditLog({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: "org.support_access_policy_changed",
    entityType: "Organization",
    entityId: params.organizationId,
    metadata: { allowSupportAccess: params.allowSupportAccess, endedSessions },
  });

  return { allowSupportAccess: params.allowSupportAccess, endedSessions };
}
