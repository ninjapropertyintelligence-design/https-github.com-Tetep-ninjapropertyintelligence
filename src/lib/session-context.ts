import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { Permission, hasPermission, permissionsForRole } from "@/lib/permissions";
import { SessionContext } from "@/lib/tenant-scope";

// Re-export the pure scope logic + type so existing call sites can keep
// importing everything from "@/lib/session-context" — the split from
// tenant-scope.ts (see that file's header comment) is an internal
// implementation detail, not an API change.
export type { SessionContext, AccessGrantScope } from "@/lib/tenant-scope";
export { propertyScopeWhere, issueScopeWhere, canAccessProperty } from "@/lib/tenant-scope";

export const ACTIVE_ORG_COOKIE = "activeOrgId";

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthenticatedError";
  }
}

export class NoOrganizationError extends Error {
  constructor() {
    super("User has no organization membership");
    this.name = "NoOrganizationError";
  }
}

/**
 * Resolves the full server-side session context for the current request:
 * authenticated user -> active organization -> role -> scoped access grants
 * -> computed permission set. Returns null if unauthenticated or the user
 * has no membership in any organization (platform admins with no org
 * membership still resolve, but with organizationId set to their platform
 * console context only — callers needing org data should require one).
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      memberships: {
        include: { accessGrants: true, organization: true },
      },
    },
  });

  if (!user || !user.isActive) {
    return null;
  }

  if (user.memberships.length === 0) {
    if (user.isPlatformAdmin) {
      // Platform admins may exist with no tenant membership at all — valid
      // for the platform admin console, which is org-agnostic.
      return {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        isPlatformAdmin: true,
        organizationId: "",
        organizationName: "",
        membershipId: "",
        role: Role.PLATFORM_ADMIN,
        vendorId: null,
        grants: [],
        permissions: permissionsForRole(Role.PLATFORM_ADMIN),
      };
    }
    return null;
  }

  const cookieStore = await cookies();
  const preferredOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const membership =
    user.memberships.find((m) => m.organizationId === preferredOrgId) ??
    user.memberships[0];

  return {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    isPlatformAdmin: user.isPlatformAdmin,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    membershipId: membership.id,
    role: membership.role,
    vendorId: membership.vendorId,
    grants: membership.accessGrants.map((g) => ({
      scopeType: g.scopeType,
      portfolioId: g.portfolioId,
      regionId: g.regionId,
      propertyId: g.propertyId,
    })),
    permissions: permissionsForRole(membership.role),
  };
}

/** Throws if there is no session. Use in API routes / server actions. */
export async function requireSessionContext(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new UnauthenticatedError();
  return ctx;
}

export function can(ctx: SessionContext, permission: Permission): boolean {
  if (ctx.isPlatformAdmin && permission === "canAccessPlatformAdmin") return true;
  return hasPermission(ctx.role, permission);
}
