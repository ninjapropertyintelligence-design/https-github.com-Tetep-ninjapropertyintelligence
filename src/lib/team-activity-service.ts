import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { Role } from "@/generated/prisma/client";
import { hasPermission, isOrgWideRole } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/role-labels";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Who is on the team, what each person can reach, and what they have been
 * doing — for the organization's Owner and Portfolio Admins.
 *
 * Built from records that already exist rather than new tracking: sign-ins
 * and changes come from the audit trail, page use from product analytics.
 */

const LOGIN_ACTIONS = ["login", "logout", "login.failed"];

export type ActivityKind = "all" | "logins" | "changes" | "views";

function requireTeamViewer(ctx: SessionContext) {
  if (!ctx.organizationId || (!hasPermission(ctx.role, "canManageTeam") && !hasPermission(ctx.role, "canViewTeamActivity"))) {
    throw new ApiError(403, "Missing permission: canViewTeamActivity");
  }
}

function requireActivityViewer(ctx: SessionContext) {
  if (!ctx.organizationId || !hasPermission(ctx.role, "canViewTeamActivity")) {
    throw new ApiError(403, "Missing permission: canViewTeamActivity");
  }
}

export interface TeamMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  role: Role;
  roleLabel: string;
  /** Plain-language description of what this person can see. */
  access: string[];
  lastSignInAt: Date | null;
  lastActiveAt: Date | null;
  /** Actions and page views in the last 30 days. */
  recentActivityCount: number;
}

/** Everyone in the organization with their access and when they were last seen. */
export async function listTeamMembers(ctx: SessionContext): Promise<TeamMember[]> {
  requireTeamViewer(ctx);
  const memberships = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, name: true, email: true, isActive: true } },
      vendor: { select: { name: true } },
      accessGrants: {
        include: {
          portfolio: { select: { name: true } },
          region: { select: { name: true } },
          property: { select: { name: true } },
        },
      },
    },
  });
  const userIds = memberships.map((m) => m.userId);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [signIns, changes, views] = await Promise.all([
    // A sign-in is recorded under the person's first organization, so it is
    // looked up by person: "last signed in" means to the product, wherever.
    prisma.auditLog.groupBy({
      by: ["actorUserId"],
      where: { action: "login", actorUserId: { in: userIds } },
      _max: { createdAt: true },
    }),
    prisma.auditLog.groupBy({
      by: ["actorUserId"],
      where: { organizationId: ctx.organizationId, actorUserId: { in: userIds }, action: { notIn: LOGIN_ACTIONS } },
      _max: { createdAt: true },
      _count: { _all: true },
    }),
    prisma.productEvent.groupBy({
      by: ["userId"],
      where: { organizationId: ctx.organizationId, userId: { in: userIds }, impersonated: false },
      _max: { occurredAt: true },
      _count: { _all: true },
    }),
  ]);
  const [recentChanges, recentViews] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ["actorUserId"],
      where: { organizationId: ctx.organizationId, actorUserId: { in: userIds }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.productEvent.groupBy({
      by: ["userId"],
      where: { organizationId: ctx.organizationId, userId: { in: userIds }, impersonated: false, occurredAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const signInBy = new Map(signIns.map((r) => [r.actorUserId, r._max.createdAt]));
  const changeBy = new Map(changes.map((r) => [r.actorUserId, r._max.createdAt]));
  const viewBy = new Map(views.map((r) => [r.userId, r._max.occurredAt]));
  const recentCount = new Map<string, number>();
  for (const r of recentChanges) if (r.actorUserId) recentCount.set(r.actorUserId, r._count._all);
  for (const r of recentViews) {
    if (r.userId) recentCount.set(r.userId, (recentCount.get(r.userId) ?? 0) + r._count._all);
  }

  return memberships.map((m) => {
    const lastSignInAt = signInBy.get(m.userId) ?? null;
    const lastActiveAt = latest([lastSignInAt, changeBy.get(m.userId) ?? null, viewBy.get(m.userId) ?? null]);
    return {
      membershipId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      isActive: m.user.isActive,
      role: m.role,
      roleLabel: ROLE_LABELS[m.role],
      access: describeAccess(m.role, m.vendor?.name ?? null, m.accessGrants),
      lastSignInAt,
      lastActiveAt,
      recentActivityCount: recentCount.get(m.userId) ?? 0,
    };
  });
}

function latest(dates: Array<Date | null>): Date | null {
  return dates.reduce<Date | null>((max, d) => (d && (!max || d > max) ? d : max), null);
}

function describeAccess(
  role: Role,
  vendorName: string | null,
  grants: Array<{
    scopeType: string;
    portfolio: { name: string } | null;
    region: { name: string } | null;
    property: { name: string } | null;
  }>,
): string[] {
  if (isOrgWideRole(role)) return ["Whole organization"];
  if (role === Role.VENDOR) {
    return [`${vendorName ?? "Vendor"} — only sites on its open capture jobs`];
  }
  const parts = grants.map((g) => {
    if (g.scopeType === "PORTFOLIO") return `Portfolio: ${g.portfolio?.name ?? "removed"}`;
    if (g.scopeType === "REGION") return `Region: ${g.region?.name ?? "removed"}`;
    return g.property?.name ?? "Removed property";
  });
  return parts.length ? parts : ["No access yet"];
}

export interface ActivityEntry {
  id: string;
  at: Date;
  kind: "login" | "change" | "view";
  userId: string | null;
  userName: string | null;
  description: string;
  /** Set when platform support did this while viewing the account. */
  bySupport: boolean;
  ipAddress: string | null;
}

const PAGE_SIZE = 100;

/**
 * The organization's activity, newest first: sign-ins, changes, and pages
 * used, optionally for one person. Paged by time — pass the `at` of the last
 * entry as `before` to read further back.
 */
export async function listActivity(
  ctx: SessionContext,
  filter: { userId?: string | null; kind?: ActivityKind; before?: Date | null },
): Promise<{ entries: ActivityEntry[]; hasMore: boolean }> {
  requireActivityViewer(ctx);
  const kind = filter.kind ?? "all";
  const before = filter.before ?? undefined;
  const userId = filter.userId || undefined;

  // Only people in this organization can be asked about.
  if (userId) {
    const member = await prisma.membership.findFirst({
      where: { organizationId: ctx.organizationId, userId },
      select: { id: true },
    });
    if (!member) throw new ApiError(404, "That person is not in this organization");
  }

  const actionFilter =
    kind === "logins" ? { in: LOGIN_ACTIONS } : kind === "changes" ? { notIn: LOGIN_ACTIONS } : undefined;
  const wantAudit = kind !== "views";
  const wantViews = kind === "all" || kind === "views";

  const [audit, views] = await Promise.all([
    wantAudit
      ? prisma.auditLog.findMany({
          where: {
            organizationId: ctx.organizationId,
            ...(userId ? { actorUserId: userId } : {}),
            ...(actionFilter ? { action: actionFilter } : {}),
            ...(before ? { createdAt: { lt: before } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: PAGE_SIZE + 1,
          include: { actor: { select: { name: true } } },
        })
      : [],
    wantViews
      ? prisma.productEvent.findMany({
          where: {
            organizationId: ctx.organizationId,
            ...(userId ? { userId } : {}),
            ...(before ? { occurredAt: { lt: before } } : {}),
          },
          orderBy: { occurredAt: "desc" },
          take: PAGE_SIZE + 1,
          include: { user: { select: { name: true } } },
        })
      : [],
  ]);

  const merged: ActivityEntry[] = [
    ...audit.map((a) => ({
      id: `a-${a.id}`,
      at: a.createdAt,
      kind: LOGIN_ACTIONS.includes(a.action) ? ("login" as const) : ("change" as const),
      userId: a.actorUserId,
      userName: a.actor?.name ?? null,
      description: describeAction(a.action),
      bySupport: isSupportMetadata(a.metadata),
      ipAddress: a.ipAddress,
    })),
    ...views.map((v) => ({
      id: `v-${v.id}`,
      at: v.occurredAt,
      kind: "view" as const,
      userId: v.userId,
      userName: v.user?.name ?? null,
      description: describeFeature(v.feature),
      bySupport: v.impersonated,
      ipAddress: null,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return { entries: merged.slice(0, PAGE_SIZE), hasMore: merged.length > PAGE_SIZE };
}

function isSupportMetadata(metadata: unknown): boolean {
  return typeof metadata === "object" && metadata !== null && (metadata as Record<string, unknown>).byPlatform === true;
}

const ACTION_LABELS: Record<string, string> = {
  login: "Signed in",
  logout: "Signed out",
  "login.failed": "Failed sign-in attempt",
  "password.reset_requested": "Requested a password reset",
  "password.reset_completed": "Reset their password",
  "mfa.enabled": "Turned on two-step sign-in",
  "mfa.disabled": "Turned off two-step sign-in",
  "invitation.created": "Invited someone to the team",
  "invitation.accepted": "Accepted their invitation",
  "invitation.revoked": "Cancelled an invitation",
  "invitation.resent": "Re-sent an invitation",
  "property.created": "Added a property",
  "property.updated": "Updated a property",
  "issue.created": "Reported an issue",
  "document.uploaded": "Uploaded a document",
  "report.exported": "Exported a report",
  "import.uploaded": "Uploaded an import file",
  "import.completed": "Completed an import",
  "vendor.created": "Added a vendor company",
  "capture_job.created": "Created a capture job",
};

const FEATURE_LABELS: Record<string, string> = {
  "dashboard.viewed": "Opened the dashboard",
  "portfolio.viewed": "Browsed properties",
  "property.viewed": "Opened a property",
  "map.viewed": "Opened the map",
  "asset.viewed": "Opened an asset",
  "ai.question_asked": "Asked the AI a question",
  "report.generated": "Generated a report",
  "cogs.viewed": "Opened Cost to Serve",
};

/** "retention.policy_updated" → "Retention: policy updated", unless it has a better name. */
export function describeAction(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const [area, ...rest] = action.split(".");
  const what = rest.join(" ").replace(/_/g, " ");
  const subject = capitalize(area.replace(/_/g, " "));
  return what ? `${subject}: ${what}` : subject;
}

export function describeFeature(feature: string): string {
  if (FEATURE_LABELS[feature]) return FEATURE_LABELS[feature];
  return capitalize(feature.replace(/[._]/g, " "));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
