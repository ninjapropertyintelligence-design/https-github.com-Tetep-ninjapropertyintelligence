import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { hasPermission, isOrgWideRole } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/role-labels";
import { AccessScopeType, Role } from "@/generated/prisma/client";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * What a membership may be, in one place.
 *
 * Inviting someone and changing an existing member's role are the same
 * decision made at different times, so they share these rules. If they lived
 * in two services they would drift, and the gap between them would be a way
 * round whichever was stricter.
 */

/** Roles that see nothing without an explicit grant. Vendors are scoped by their jobs instead. */
export const ROLES_NEEDING_GRANTS: Role[] = [
  Role.REGIONAL_MANAGER,
  Role.FACILITIES_MANAGER,
  Role.INSPECTOR,
  Role.TECHNICIAN,
];

export interface GrantInput {
  scopeType: AccessScopeType;
  /** The portfolio, region or property id, per scopeType. */
  id: string;
}

/** The shape of an AccessGrant row, minus its membership. */
export interface StoredGrant {
  scopeType: AccessScopeType;
  portfolioId: string | null;
  regionId: string | null;
  propertyId: string | null;
}

export function requireTeamManager(ctx: SessionContext) {
  if (!ctx.organizationId || !hasPermission(ctx.role, "canManageTeam")) {
    throw new ApiError(403, "Missing permission: canManageTeam");
  }
}

export function toStoredGrant(input: GrantInput): StoredGrant {
  return {
    scopeType: input.scopeType,
    portfolioId: input.scopeType === "PORTFOLIO" ? input.id : null,
    regionId: input.scopeType === "REGION" ? input.id : null,
    propertyId: input.scopeType === "PROPERTY" ? input.id : null,
  };
}

/** Keeps only grants whose target still belongs to this organization. */
export async function grantsInOrganization(organizationId: string, grants: StoredGrant[]): Promise<StoredGrant[]> {
  const ids = (type: AccessScopeType, key: keyof StoredGrant) =>
    grants.filter((g) => g.scopeType === type).map((g) => g[key] as string);
  const [portfolios, regions, properties] = await Promise.all([
    prisma.portfolio.findMany({ where: { id: { in: ids("PORTFOLIO", "portfolioId") }, organizationId }, select: { id: true } }),
    prisma.region.findMany({ where: { id: { in: ids("REGION", "regionId") }, portfolio: { organizationId } }, select: { id: true } }),
    prisma.property.findMany({ where: { id: { in: ids("PROPERTY", "propertyId") }, organizationId }, select: { id: true } }),
  ]);
  const valid = new Set([...portfolios, ...regions, ...properties].map((r) => r.id));
  return grants.filter((g) => valid.has((g.portfolioId ?? g.regionId ?? g.propertyId) as string));
}

/**
 * Checks a role, vendor company and grants against the rules, and returns the
 * vendor id and grants to store.
 *
 * - Platform Admin is never an organization's to give, and only an Owner can
 *   make someone an Owner.
 * - A vendor must belong to one of this organization's vendor companies.
 * - A scoped role needs at least one grant, all in this organization; an
 *   org-wide role or a vendor takes none, because a grant on either would be
 *   dead data that reads as meaningful.
 */
export async function resolveMembershipShape(
  ctx: SessionContext,
  input: { role: Role; vendorId?: string | null; grants?: GrantInput[] },
): Promise<{ vendorId: string | null; grants: StoredGrant[] }> {
  if (input.role === Role.PLATFORM_ADMIN) {
    throw new ApiError(400, "Platform Admin is not a role an organization can give out");
  }
  if (input.role === Role.OWNER && ctx.role !== Role.OWNER) {
    throw new ApiError(403, "Only an Owner can make someone an Owner");
  }

  let vendorId: string | null = null;
  if (input.role === Role.VENDOR) {
    if (!input.vendorId) throw new ApiError(400, "Choose the vendor company this person works for");
    const vendor = await prisma.vendor.findFirst({
      where: { id: input.vendorId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!vendor) throw new ApiError(400, "That vendor company does not exist in this organization");
    vendorId = vendor.id;
  }

  const requested = (input.grants ?? []).map(toStoredGrant);
  if (ROLES_NEEDING_GRANTS.includes(input.role)) {
    if (requested.length === 0) {
      throw new ApiError(400, `A ${ROLE_LABELS[input.role]} needs at least one portfolio, region or property to see`);
    }
    const grants = await grantsInOrganization(ctx.organizationId, requested);
    if (grants.length !== requested.length) {
      throw new ApiError(400, "One or more of the chosen portfolios, regions or properties is not in this organization");
    }
    return { vendorId, grants };
  }
  if (requested.length > 0) {
    throw new ApiError(
      400,
      isOrgWideRole(input.role)
        ? `A ${ROLE_LABELS[input.role]} already sees the whole organization`
        : "A vendor's access comes from the capture jobs it is sent, not from grants",
    );
  }
  return { vendorId, grants: [] };
}
