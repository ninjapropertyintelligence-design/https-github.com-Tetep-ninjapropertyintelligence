import { prisma } from "@/lib/prisma";
import { NotificationType, Role } from "@/generated/prisma/client";

/**
 * Finds every membership in the org whose role/scope should be informed
 * about something happening at a given property: org-wide roles (Owner,
 * Portfolio Admin) always; Regional Manager / Facilities Manager only if
 * their AccessGrants cover this property (directly, or via its region/portfolio).
 */
async function membershipsToNotifyForProperty(propertyId: string) {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { organizationId: true, portfolioId: true, regionId: true },
  });
  if (!property) return null;

  const orgWide = await prisma.membership.findMany({
    where: {
      organizationId: property.organizationId,
      role: { in: [Role.OWNER, Role.PORTFOLIO_ADMIN] },
    },
    select: { userId: true },
  });

  const scoped = await prisma.membership.findMany({
    where: {
      organizationId: property.organizationId,
      role: { in: [Role.REGIONAL_MANAGER, Role.FACILITIES_MANAGER] },
      accessGrants: {
        some: {
          OR: [
            { propertyId },
            ...(property.regionId ? [{ regionId: property.regionId }] : []),
            { portfolioId: property.portfolioId },
          ],
        },
      },
    },
    select: { userId: true },
  });

  const userIds = new Set([...orgWide, ...scoped].map((m) => m.userId));
  return { organizationId: property.organizationId, userIds: [...userIds] };
}

export async function notifyPropertyStakeholders(params: {
  propertyId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  const result = await membershipsToNotifyForProperty(params.propertyId);
  if (!result || result.userIds.length === 0) return;

  await prisma.notification.createMany({
    data: result.userIds.map((userId) => ({
      organizationId: result.organizationId,
      userId,
      type: params.type,
      title: params.title,
      body: params.body,
      link: params.link,
    })),
  });
}

export async function notifyUser(params: {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  return prisma.notification.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      link: params.link,
    },
  });
}

/**
 * Notifies every user who belongs to a vendor company.
 *
 * A vendor is a company, not a person — the subcontractor who walked the site
 * and the office manager who chases rejections are usually different people,
 * and either of them fixing a returned site is a good outcome. So this goes
 * to the company's whole membership rather than to whoever happened to press
 * submit.
 *
 * Scoped by organization as well as vendor id: the same contracting firm can
 * hold memberships in two customer organizations, and one customer's review
 * decision must not surface in the other's.
 */
export async function notifyVendorUsers(params: {
  organizationId: string;
  vendorId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: params.organizationId,
      vendorId: params.vendorId,
      role: Role.VENDOR,
    },
    select: { userId: true },
  });
  if (memberships.length === 0) return;

  const userIds = [...new Set(memberships.map((m) => m.userId))];
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      organizationId: params.organizationId,
      userId,
      type: params.type,
      title: params.title,
      body: params.body,
      link: params.link,
    })),
  });
}
