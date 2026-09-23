import { prisma } from "@/lib/prisma";
import { CaptureJobStatus as JobStatus, Prisma, Role } from "@/generated/prisma/client";
import { Permission, isOrgWideRole } from "@/lib/permissions";

/**
 * Pure tenant/scope authorization logic — no Next.js request context, no
 * next-auth. Deliberately split from `session-context.ts` (which resolves
 * cookies/JWT into a SessionContext) so this can be unit/integration tested
 * directly against Postgres without dragging in `next/headers` or the auth
 * config, and so nothing here can accidentally depend on request framing.
 */

export interface AccessGrantScope {
  scopeType: "PORTFOLIO" | "REGION" | "PROPERTY";
  portfolioId: string | null;
  regionId: string | null;
  propertyId: string | null;
}

/**
 * The single, server-resolved description of "who is asking and what can
 * they see." Every API route and server component that touches org-owned
 * data must obtain one of these and use it to build Prisma `where` clauses —
 * never trust an organizationId/propertyId the client claims to be theirs
 * without checking it against this context.
 */
export interface SessionContext {
  userId: string;
  userName: string;
  userEmail: string;
  isPlatformAdmin: boolean;
  organizationId: string;
  organizationName: string;
  membershipId: string;
  role: Role;
  vendorId: string | null;
  grants: AccessGrantScope[];
  permissions: Permission[];
  /** The active organization requires MFA of every member (spec §43). */
  mfaRequired: boolean;
  /** This user has an activated second factor. */
  mfaEnrolled: boolean;
  /**
   * Set when this request is platform support viewing a customer's account
   * (spec §45). When set, `organizationId`/`role` describe the *customer's*
   * context, not the admin's — so every existing scope query keeps working
   * unchanged — and `isPlatformAdmin` is false, so nothing cross-tenant is
   * reachable while impersonating.
   */
  impersonation: ImpersonationInfo | null;
}

export interface ImpersonationInfo {
  sessionId: string;
  adminUserId: string;
  adminName: string;
  adminEmail: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
}

/**
 * True when the org's MFA policy is satisfied. Resolved once here so the
 * layout guard and the API guard can never drift apart — a policy enforced
 * in the UI but not on the API would be theatre.
 */
export function mfaPolicySatisfied(ctx: SessionContext): boolean {
  return !ctx.mfaRequired || ctx.mfaEnrolled;
}

/**
 * Builds a Prisma `Property.where` fragment that restricts results to
 * exactly what this session is allowed to see. This is the enforcement
 * point for tenant isolation + scope (portfolio/region/property).
 * ALWAYS combine API list/detail queries through this — never take
 * organizationId/propertyId from the request body/query as the sole filter.
 */
/** Job states in which a subcontractor still needs to reach the site. */
const OPEN_CAPTURE_JOB_STATUSES = [JobStatus.ISSUED, JobStatus.SUBMITTED, JobStatus.REJECTED] as const;

export function propertyScopeWhere(ctx: SessionContext): Prisma.PropertyWhereInput {
  const base: Prisma.PropertyWhereInput = { organizationId: ctx.organizationId };

  if (isOrgWideRole(ctx.role)) {
    return base;
  }

  // Scoped role (Regional Manager, Facilities Manager, Inspector, Technician,
  // Vendor): only properties reachable via an explicit AccessGrant. No
  // grants => this OR array is empty => Prisma treats `OR: []` as matching
  // nothing, which is the secure-by-default outcome we want.
  const portfolioIds = ctx.grants
    .filter((g) => g.scopeType === "PORTFOLIO" && g.portfolioId)
    .map((g) => g.portfolioId as string);
  const regionIds = ctx.grants
    .filter((g) => g.scopeType === "REGION" && g.regionId)
    .map((g) => g.regionId as string);
  const propertyIds = ctx.grants
    .filter((g) => g.scopeType === "PROPERTY" && g.propertyId)
    .map((g) => g.propertyId as string);

  const or: Prisma.PropertyWhereInput[] = [];
  if (portfolioIds.length) or.push({ portfolioId: { in: portfolioIds } });
  if (regionIds.length) or.push({ regionId: { in: regionIds } });
  if (propertyIds.length) or.push({ id: { in: propertyIds } });

  // A capture subcontractor's access comes from the work, not from a standing
  // grant. They reach exactly the sites on their OPEN jobs: access starts when
  // the job is issued and ends when it is accepted or cancelled, with nobody
  // having to remember to revoke anything. Leaving contractor accounts live
  // after the work is done is the usual way this goes wrong.
  //
  // SUBMITTED and REJECTED stay open deliberately — a vendor has to be able to
  // see what they delivered, and to fix a site that was sent back.
  if (ctx.vendorId) {
    or.push({
      captureJobSites: {
        some: {
          job: {
            vendorId: ctx.vendorId,
            status: { in: [...OPEN_CAPTURE_JOB_STATUSES] },
          },
        },
      },
    });
  }

  return { ...base, OR: or.length ? or : [{ id: "__no_access__" }] };
}

/**
 * Builds an `Issue.where` fragment. Vendors are scoped by assignment
 * (`vendorId`), not by the property graph — a roofing vendor should see the
 * issues assigned to their company across whichever properties those touch,
 * without being granted general property access. Every other role scopes
 * through the property graph like everything else.
 */
export function issueScopeWhere(ctx: SessionContext): Prisma.IssueWhereInput {
  if (ctx.role === Role.VENDOR) {
    if (!ctx.vendorId) return { organizationId: ctx.organizationId, id: "__no_access__" };
    return { organizationId: ctx.organizationId, vendorId: ctx.vendorId };
  }
  return { organizationId: ctx.organizationId, property: propertyScopeWhere(ctx) };
}

/** True if this session may access the given propertyId, checked against the DB. */
export async function canAccessProperty(ctx: SessionContext, propertyId: string): Promise<boolean> {
  const property = await prisma.property.findFirst({
    where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] },
    select: { id: true },
  });
  return !!property;
}
