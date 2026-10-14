import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { appBaseUrl, sendEmail } from "@/lib/email";
import { removedFromOrganizationEmail, roleChangedEmail } from "@/lib/email-templates";
import { type GrantInput, requireTeamManager, resolveMembershipShape } from "@/lib/membership-rules";
import { ROLE_LABELS } from "@/lib/role-labels";
import { Role } from "@/generated/prisma/client";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Changing a member's role, and removing a member.
 *
 * Both take effect on the member's very next request: the session is resolved
 * from the database every time (`getSessionContext`), never from a role baked
 * into the sign-in token. Removing someone ends their access to this
 * organization only — the account stays, because the same person may belong
 * to another customer, and their history (uploads, issues, audit entries)
 * stays attributed to them.
 *
 * The rules:
 * - The role, vendor company and grants follow the same rules as an
 *   invitation (`resolveMembershipShape`).
 * - Nobody changes or removes themselves here. Doing it by accident is how an
 *   admin locks themselves out; another admin can do it for them.
 * - Only an Owner can change or remove an Owner, or make someone an Owner.
 * - An organization always keeps at least one Owner.
 */

async function loadMembership(ctx: SessionContext, membershipId: string) {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: ctx.organizationId },
    include: {
      user: { select: { id: true, name: true, email: true, isActive: true } },
      organization: { select: { name: true } },
      accessGrants: true,
    },
  });
  if (!membership) throw new ApiError(404, "Member not found");
  return membership;
}

function assertMayManage(ctx: SessionContext, membership: { userId: string; role: Role }, verb: "change" | "remove") {
  if (membership.userId === ctx.userId) {
    throw new ApiError(400, `You cannot ${verb} your own membership. Ask another admin.`);
  }
  if (membership.role === Role.OWNER && ctx.role !== Role.OWNER) {
    throw new ApiError(403, `Only an Owner can ${verb} an Owner`);
  }
}

async function assertNotLastOwner(organizationId: string, membership: { role: Role }) {
  if (membership.role !== Role.OWNER) return;
  const owners = await prisma.membership.count({ where: { organizationId, role: Role.OWNER } });
  if (owners <= 1) {
    throw new ApiError(409, "An organization needs at least one Owner. Make someone else an Owner first.");
  }
}

export async function updateMembership(
  ctx: SessionContext,
  membershipId: string,
  input: { role: Role; vendorId?: string | null; grants?: GrantInput[] },
) {
  requireTeamManager(ctx);
  const membership = await loadMembership(ctx, membershipId);
  assertMayManage(ctx, membership, "change");
  if (membership.role === Role.OWNER && input.role !== Role.OWNER) {
    await assertNotLastOwner(ctx.organizationId, membership);
  }

  const { vendorId, grants } = await resolveMembershipShape(ctx, input);

  const updated = await prisma.$transaction(async (tx) => {
    // Replaced, not merged: what the admin submitted is the whole of what this
    // person may now see. A leftover grant from the old role would be access
    // nobody chose.
    await tx.accessGrant.deleteMany({ where: { membershipId: membership.id } });
    return tx.membership.update({
      where: { id: membership.id },
      data: { role: input.role, vendorId, accessGrants: { create: grants } },
      include: { accessGrants: true },
    });
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "membership.updated",
    entityType: "Membership",
    entityId: membership.id,
    metadata: {
      userId: membership.userId,
      before: { role: membership.role, vendorId: membership.vendorId, grants: membership.accessGrants.length },
      after: { role: input.role, vendorId, grants: grants.length },
    },
  });

  if (membership.user.isActive && membership.role !== input.role) {
    await sendEmail(
      roleChangedEmail({
        to: membership.user.email,
        name: membership.user.name,
        organizationName: membership.organization.name,
        roleLabel: ROLE_LABELS[input.role],
        changedBy: ctx.userName,
        appUrl: `${appBaseUrl()}/dashboard`,
      }),
    );
  }

  return updated;
}

export async function removeMember(ctx: SessionContext, membershipId: string) {
  requireTeamManager(ctx);
  const membership = await loadMembership(ctx, membershipId);
  assertMayManage(ctx, membership, "remove");
  await assertNotLastOwner(ctx.organizationId, membership);

  // Grants go with the membership (cascade). Issues assigned to them stay
  // assigned, so a reviewer can see who held them and reassign.
  await prisma.membership.delete({ where: { id: membership.id } });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "membership.removed",
    entityType: "Membership",
    entityId: membership.id,
    metadata: { userId: membership.userId, email: membership.user.email, role: membership.role },
  });

  if (membership.user.isActive) {
    await sendEmail(
      removedFromOrganizationEmail({
        to: membership.user.email,
        name: membership.user.name,
        organizationName: membership.organization.name,
        removedBy: ctx.userName,
      }),
    );
  }
}
