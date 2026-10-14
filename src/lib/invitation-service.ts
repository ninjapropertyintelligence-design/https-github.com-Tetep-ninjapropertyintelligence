import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { appBaseUrl, sendEmail } from "@/lib/email";
import { invitationEmail } from "@/lib/email-templates";
import { notifyUser } from "@/lib/notifications";
import { passwordProblem } from "@/lib/password-reset-service";
import { INVITATION_ACCEPT_RULE, checkRateLimit } from "@/lib/rate-limit";
import { ROLE_LABELS } from "@/lib/role-labels";
import { Prisma, Role } from "@/generated/prisma/client";
import {
  type GrantInput,
  type StoredGrant,
  grantsInOrganization,
  requireTeamManager,
  resolveMembershipShape,
} from "@/lib/membership-rules";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Inviting people into an organization.
 *
 * An invitation is the membership-to-be: role, vendor company and access
 * scopes are fixed by the admin when it is sent, and accepting it creates
 * exactly that. The invitee chooses only their name and password.
 *
 * The rules:
 * - Only members who can manage the team may invite, and nobody can hand out
 *   more than they hold: only an Owner can invite an Owner, and nobody can
 *   invite a Platform Admin.
 * - A scoped role (manager, inspector, technician) must be given at least one
 *   portfolio, region or property, or it would join able to see nothing. A
 *   vendor must be tied to a vendor company; its property access comes from
 *   capture jobs, never from a standing grant.
 * - The link works once, for seven days, and only the newest one sent to an
 *   address works. Only a hash of it is stored.
 * - Someone who already has an account (a subcontractor working for two
 *   customers) joins with the account they have; their password is untouched.
 */

export const INVITATION_TTL_DAYS = 7;
const BCRYPT_COST = 10;

export interface CreateInvitationInput {
  email: string;
  name?: string | null;
  role: Role;
  vendorId?: string | null;
  grants?: GrantInput[];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
}

function acceptUrl(token: string) {
  return `${appBaseUrl()}/invite?token=${encodeURIComponent(token)}`;
}

async function sendInvitationEmail(params: {
  email: string;
  token: string;
  role: Role;
  organizationId: string;
  inviterName: string;
}) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: params.organizationId },
    select: { name: true },
  });
  return sendEmail(
    invitationEmail({
      to: params.email,
      inviterName: params.inviterName,
      organizationName: org.name,
      roleLabel: ROLE_LABELS[params.role],
      acceptUrl: acceptUrl(params.token),
      expiresInDays: INVITATION_TTL_DAYS,
    }),
  );
}

/** What callers may see of an invitation. Never the token or its hash. */
const PUBLIC_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  vendorId: true,
  grants: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
  vendor: { select: { id: true, name: true } },
  invitedBy: { select: { id: true, name: true } },
} satisfies Prisma.InvitationSelect;

export async function createInvitation(ctx: SessionContext, input: CreateInvitationInput) {
  requireTeamManager(ctx);
  const email = input.email.toLowerCase().trim();

  const { vendorId, grants } = await resolveMembershipShape(ctx, input);

  const existingMember = await prisma.membership.findFirst({
    where: { organizationId: ctx.organizationId, user: { email } },
    select: { id: true },
  });
  if (existingMember) throw new ApiError(409, "That person is already a member of this organization");

  const { token, tokenHash, expiresAt } = newToken();
  const invitation = await prisma.$transaction(async (tx) => {
    // Only the newest invitation to an address works; sending again replaces it.
    await tx.invitation.updateMany({
      where: { organizationId: ctx.organizationId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.invitation.create({
      data: {
        organizationId: ctx.organizationId,
        email,
        name: input.name?.trim() || null,
        role: input.role,
        vendorId,
        grants: grants as unknown as Prisma.InputJsonValue,
        tokenHash,
        expiresAt,
        invitedById: ctx.userId,
      },
      select: PUBLIC_SELECT,
    });
  });

  await Promise.all([
    writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "invitation.created",
      entityType: "Invitation",
      entityId: invitation.id,
      metadata: { email, role: input.role },
    }),
    emitEvent({
      organizationId: ctx.organizationId,
      type: EVENT_TYPES.USER_INVITED,
      actorUserId: ctx.userId,
      payload: { invitationId: invitation.id, role: input.role },
    }),
  ]);

  const emailSent = await sendInvitationEmail({
    email,
    token,
    role: input.role,
    organizationId: ctx.organizationId,
    inviterName: ctx.userName,
  });
  return { invitation, emailSent };
}

/** Invitations still waiting on the invitee, newest first. */
export async function listPendingInvitations(ctx: SessionContext) {
  requireTeamManager(ctx);
  return prisma.invitation.findMany({
    where: { organizationId: ctx.organizationId, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: PUBLIC_SELECT,
  });
}

async function loadPending(ctx: SessionContext, id: string) {
  const invitation = await prisma.invitation.findFirst({
    where: { id, organizationId: ctx.organizationId, acceptedAt: null, revokedAt: null },
  });
  if (!invitation) throw new ApiError(404, "Invitation not found, or already accepted or cancelled");
  return invitation;
}

/** Sends a fresh link and restarts the clock. The old link stops working. */
export async function resendInvitation(ctx: SessionContext, id: string) {
  requireTeamManager(ctx);
  const existing = await loadPending(ctx, id);
  if (existing.role === Role.OWNER && ctx.role !== Role.OWNER) {
    throw new ApiError(403, "Only an Owner can invite another Owner");
  }
  const { token, tokenHash, expiresAt } = newToken();
  await prisma.invitation.update({ where: { id: existing.id }, data: { tokenHash, expiresAt } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "invitation.resent",
    entityType: "Invitation",
    entityId: existing.id,
  });
  const emailSent = await sendInvitationEmail({
    email: existing.email,
    token,
    role: existing.role,
    organizationId: ctx.organizationId,
    inviterName: ctx.userName,
  });
  return { emailSent };
}

export async function revokeInvitation(ctx: SessionContext, id: string) {
  requireTeamManager(ctx);
  const existing = await loadPending(ctx, id);
  await prisma.invitation.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "invitation.revoked",
    entityType: "Invitation",
    entityId: existing.id,
  });
}

async function findRedeemable(token: string) {
  if (!token) return null;
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      organization: { select: { id: true, name: true } },
      invitedBy: { select: { id: true, name: true } },
    },
  });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) return null;
  return invitation;
}

/** What the accept page shows, or null when the link is no good. */
export async function describeInvitation(token: string) {
  const invitation = await findRedeemable(token);
  if (!invitation) return null;
  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, isActive: true },
  });
  return {
    email: invitation.email,
    name: invitation.name,
    roleLabel: ROLE_LABELS[invitation.role],
    organizationName: invitation.organization.name,
    inviterName: invitation.invitedBy?.name ?? null,
    hasAccount: !!existingUser,
  };
}

/**
 * Accepts an invitation. A new person sets their name and password here; an
 * existing account joins as it is and its password is never changed — the
 * link proves the inbox, not that this is the account's owner choosing a new
 * password.
 */
export async function acceptInvitation(
  token: string,
  input: { name?: string | null; password?: string | null },
  ip: string | null,
): Promise<{ email: string; existingAccount: boolean }> {
  if (ip && !checkRateLimit(`invite-accept:ip:${ip}`, INVITATION_ACCEPT_RULE).allowed) {
    throw new ApiError(429, "Too many attempts. Wait a few minutes and try again.");
  }

  const invalid = new ApiError(400, "This invitation is invalid, has expired, or was already used. Ask for a new one.");
  const invitation = await findRedeemable(token);
  if (!invitation) throw invalid;

  const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (existingUser && !existingUser.isActive) {
    throw new ApiError(403, "This account has been deactivated. Contact your administrator.");
  }

  let passwordHash: string | null = null;
  let name: string | null = null;
  if (!existingUser) {
    name = (input.name ?? invitation.name ?? "").trim();
    if (!name) throw new ApiError(400, "Enter your name.");
    if (name.length > 200) throw new ApiError(400, "That name is too long.");
    const problem = passwordProblem(input.password ?? "");
    if (problem) throw new ApiError(400, problem);
    passwordHash = await bcrypt.hash(input.password!, BCRYPT_COST);
  }

  // Re-checked now, not trusted from when it was sent: a property deleted in
  // the meantime must not come back as a grant.
  const grants = await grantsInOrganization(
    invitation.organizationId,
    (invitation.grants as unknown as StoredGrant[]) ?? [],
  );

  const userId = await prisma.$transaction(async (tx) => {
    // Claimed in the statement that checks it is unclaimed, so a link
    // submitted twice cannot create two memberships.
    const { count } = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (count === 0) throw invalid;

    const user =
      existingUser ??
      (await tx.user.create({ data: { email: invitation.email, name: name!, passwordHash: passwordHash! } }));

    const alreadyMember = await tx.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: invitation.organizationId } },
    });
    if (alreadyMember) throw new ApiError(409, "You are already a member of this organization. Sign in to continue.");

    await tx.membership.create({
      data: {
        userId: user.id,
        organizationId: invitation.organizationId,
        role: invitation.role,
        vendorId: invitation.role === Role.VENDOR ? invitation.vendorId : null,
        accessGrants: { create: grants },
      },
    });
    return user.id;
  });

  await writeAuditLog({
    organizationId: invitation.organizationId,
    actorUserId: userId,
    action: "invitation.accepted",
    entityType: "Invitation",
    entityId: invitation.id,
    metadata: { ip, existingAccount: !!existingUser },
  }).catch(() => {});

  if (invitation.invitedBy) {
    const joinedName = existingUser?.name ?? name ?? invitation.email;
    await notifyUser({
      organizationId: invitation.organizationId,
      userId: invitation.invitedBy.id,
      type: "USER_INVITED",
      title: `${joinedName} joined ${invitation.organization.name}`,
      body: `They accepted your invitation as ${ROLE_LABELS[invitation.role]}.`,
      link: "/settings",
    }).catch(() => {});
  }

  return { email: invitation.email, existingAccount: !!existingUser };
}
