import { redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { getMfaStatus } from "@/lib/mfa-service";
import { MfaManager } from "@/components/security/MfaManager";
import { OrgMfaPolicy } from "@/components/security/OrgMfaPolicy";
import { prisma } from "@/lib/prisma";

/**
 * Personal security settings. Deliberately reachable by every role — a
 * Technician needs to be able to enrol in MFA just as much as an Owner, so
 * this page has no permission gate. The org-wide policy card below is the
 * part that is gated.
 */
export default async function SecuritySettingsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const canManagePolicy = Boolean(ctx.organizationId) && can(ctx, "canManageTeam");

  const [status, org, unenrolledMembers] = await Promise.all([
    getMfaStatus(ctx.userId, ctx.organizationId || null),
    ctx.organizationId
      ? prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { requireMfa: true } })
      : Promise.resolve(null),
    canManagePolicy
      ? prisma.membership.count({
          where: { organizationId: ctx.organizationId, user: { mfaEnabledAt: null, isActive: true } },
        })
      : Promise.resolve(0),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Security</h1>
        <p className="text-sm text-muted">{ctx.userEmail}</p>
      </div>

      <div className="max-w-3xl space-y-4">
        <MfaManager status={status} />
        {canManagePolicy ? (
          <OrgMfaPolicy
            requireMfa={org?.requireMfa ?? false}
            unenrolledMembers={unenrolledMembers}
            selfEnrolled={status.state === "ENABLED"}
          />
        ) : null}
      </div>
    </div>
  );
}
