import Link from "next/link";
import { redirect } from "next/navigation";
import { can, getSessionContext } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { TeamInvitations } from "@/components/settings/TeamInvitations";
import { listPendingInvitations } from "@/lib/invitation-service";
import { listTeamMembers } from "@/lib/team-activity-service";
import { ROLE_LABELS } from "@/lib/role-labels";
import { formatDate, formatDateTime, formatRelativeTime } from "@/lib/format";
import { Role } from "@/generated/prisma/client";

/**
 * The team: everyone in the organization, what each person can see, and when
 * they were last signed in and active — with a way into each person's
 * activity, and the invitations still waiting on someone.
 */
export default async function TeamPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.organizationId || !can(ctx, "canManageTeam")) redirect("/dashboard");

  const canSeeActivity = can(ctx, "canViewTeamActivity");
  const [members, pending, vendors, portfolios, regions, properties] = await Promise.all([
    listTeamMembers(ctx),
    listPendingInvitations(ctx),
    prisma.vendor.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.portfolio.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.region.findMany({
      where: { portfolio: { organizationId: ctx.organizationId } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, portfolio: { select: { name: true } } },
    }),
    prisma.property.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true, state: true },
      take: 2000,
    }),
  ]);
  // Only an Owner may invite an Owner, and Platform Admin is never an organization's to give.
  const invitableRoles = Object.values(Role)
    .filter((r) => r !== Role.PLATFORM_ADMIN && (r !== Role.OWNER || ctx.role === Role.OWNER))
    .map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  const now = new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Team</h1>
        <p className="text-sm text-muted">
          {ctx.organizationName} · {members.length} {members.length === 1 ? "member" : "members"}
        </p>
      </div>

      <Card>
        <CardHeader title="Members" subtitle="Who can sign in, what they can see, and when they were last here" />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Person</th>
                <th className="px-3 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 font-medium">Can see</th>
                <th className="px-3 py-2.5 font-medium">Last sign-in</th>
                <th className="px-3 py-2.5 font-medium">Last active</th>
                <th className="px-5 py-2.5 font-medium text-right">Last 30 days</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.membershipId} className="border-b border-border align-top last:border-0">
                  <td className="px-5 py-3">
                    <p className="font-medium text-foreground">
                      {m.name}
                      {m.isActive ? null : <span className="ml-2 text-xs font-normal text-muted">(deactivated)</span>}
                    </p>
                    <p className="text-xs text-muted">{m.email}</p>
                  </td>
                  <td className="px-3 py-3 text-foreground">{m.roleLabel}</td>
                  <td className="px-3 py-3">
                    <ul className="space-y-0.5 text-xs text-foreground">
                      {m.access.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted" title={m.lastSignInAt ? formatDateTime(m.lastSignInAt) : undefined}>
                    {m.lastSignInAt ? formatRelativeTime(m.lastSignInAt) : "Never"}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted" title={m.lastActiveAt ? formatDateTime(m.lastActiveAt) : undefined}>
                    {m.lastActiveAt ? formatRelativeTime(m.lastActiveAt) : "Never"}
                  </td>
                  <td className="px-5 py-3 text-right text-xs">
                    {canSeeActivity ? (
                      <Link href={`/settings/activity?user=${m.userId}`} className="font-medium text-brand hover:underline">
                        {m.recentActivityCount} {m.recentActivityCount === 1 ? "action" : "actions"} →
                      </Link>
                    ) : (
                      <span className="text-muted">{m.recentActivityCount}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
        <TeamInvitations
          roles={invitableRoles}
          vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
          scopes={{
            PORTFOLIO: portfolios.map((p) => ({ id: p.id, label: p.name })),
            REGION: regions.map((r) => ({ id: r.id, label: `${r.name} (${r.portfolio.name})` })),
            PROPERTY: properties.map((p) => ({
              id: p.id,
              label: [p.name, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" — "),
            })),
          }}
          pending={pending.map((inv) => ({
            id: inv.id,
            email: inv.email,
            roleLabel: ROLE_LABELS[inv.role],
            invitedBy: inv.invitedBy?.name ?? null,
            expiresAt: formatDate(inv.expiresAt),
            expired: inv.expiresAt <= now,
          }))}
        />
      </Card>
    </div>
  );
}
