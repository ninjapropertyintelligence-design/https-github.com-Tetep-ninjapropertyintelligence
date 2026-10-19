import { prisma } from "@/lib/prisma";
import { NotificationType, Role } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/permissions";
import { appBaseUrl, sendEmail } from "@/lib/email";
import { notificationEmail } from "@/lib/email-templates";
import { usersWithEmailOff } from "@/lib/notification-preferences";

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
  await deliver(result.organizationId, result.userIds, params);
}

/**
 * Tells the people who can act on a capture submission — the organization's
 * reviewers — and nobody else. A property stakeholder who cannot accept the
 * work, and cannot yet see it, gains nothing from "ready for review".
 */
export async function notifyCaptureReviewers(params: {
  organizationId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  const reviewerRoles = Object.values(Role).filter((role) => hasPermission(role, "canReviewCaptures"));
  const reviewers = await prisma.membership.findMany({
    where: { organizationId: params.organizationId, role: { in: reviewerRoles } },
    select: { userId: true },
  });
  if (reviewers.length === 0) return;
  await deliver(params.organizationId, reviewers.map((m) => m.userId), params);
}

export async function notifyUser(params: {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  await deliver(params.organizationId, [params.userId], params);
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

  await deliver(params.organizationId, memberships.map((m) => m.userId), params);
}

interface NotificationContent {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}

/**
 * The one place a notification is delivered: the in-app row, then an email
 * copy to each recipient.
 *
 * The in-app row is the record and is written first; a failure there is the
 * caller's to handle, as it always was. The email is a courtesy on top: it is
 * attempted for every recipient and never throws, because a mail outage must
 * not undo a submission or a review decision that has already happened.
 */
async function deliver(organizationId: string, userIds: string[], content: NotificationContent) {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return;

  await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      organizationId,
      userId,
      type: content.type,
      title: content.title,
      body: content.body,
      link: content.link,
    })),
  });

  try {
    // The in-app row above always goes out; the email copy respects what each
    // person chose on their notification settings page.
    const optedOut = await usersWithEmailOff(recipients, content.type);
    const users = await prisma.user.findMany({
      where: { id: { in: recipients.filter((id) => !optedOut.has(id)) }, isActive: true },
      select: { email: true, name: true },
    });
    const url = content.link ? `${appBaseUrl()}${content.link.startsWith("/") ? "" : "/"}${content.link}` : null;
    await Promise.all(
      users.map((user) =>
        sendEmail(
          notificationEmail({
            to: user.email,
            name: user.name,
            title: content.title,
            body: content.body,
            url,
            settingsUrl: `${appBaseUrl()}/settings/notifications`,
          }),
        ),
      ),
    );
  } catch (err) {
    console.error("Failed to email a notification", err);
  }
}
