import { prisma } from "@/lib/prisma";
import { NotificationType } from "@/generated/prisma/client";

/**
 * Which notification emails a person receives.
 *
 * Email only: the in-app notification is always delivered, so turning an
 * email off never makes someone miss something — it just stops the copy in
 * their inbox. Account and security email (password resets, invitations,
 * "your access changed") does not go through notifications at all and cannot
 * be turned off here.
 */

export interface NotificationTypeInfo {
  type: NotificationType;
  label: string;
  description: string;
  group: "Capture work" | "Issues" | "Assessments" | "Processing and reports" | "Team";
}

/** Every notification type, in the order the settings page shows them. */
export const NOTIFICATION_CATALOG: NotificationTypeInfo[] = [
  {
    type: "CAPTURE_SUBMITTED",
    label: "Capture ready for review",
    description: "A vendor submitted drone, 360 or Matterport work for you to accept or send back.",
    group: "Capture work",
  },
  {
    type: "CAPTURE_ACCEPTED",
    label: "Capture accepted",
    description: "Work your company delivered was accepted.",
    group: "Capture work",
  },
  {
    type: "CAPTURE_REJECTED",
    label: "Capture sent back",
    description: "Work your company delivered was sent back, with what to fix.",
    group: "Capture work",
  },
  {
    type: "ISSUE_CRITICAL",
    label: "Critical issue raised",
    description: "A critical issue was reported on a property you look after.",
    group: "Issues",
  },
  {
    type: "ISSUE_ASSIGNED",
    label: "Issue assigned to you",
    description: "Someone assigned an issue to you.",
    group: "Issues",
  },
  {
    type: "ASSESSMENT_DUE",
    label: "Assessment due",
    description: "An assessment you are responsible for is coming up.",
    group: "Assessments",
  },
  {
    type: "ASSESSMENT_OVERDUE",
    label: "Assessment overdue",
    description: "An assessment you are responsible for is past its due date.",
    group: "Assessments",
  },
  {
    type: "PROCESSING_COMPLETED",
    label: "Processing finished",
    description: "Drone or capture processing you started has finished.",
    group: "Processing and reports",
  },
  {
    type: "PROCESSING_FAILED",
    label: "Processing failed",
    description: "Drone or capture processing you started has failed.",
    group: "Processing and reports",
  },
  {
    type: "REPORT_READY",
    label: "Report ready",
    description: "A report you requested is ready to download.",
    group: "Processing and reports",
  },
  {
    type: "USER_INVITED",
    label: "Someone joined from your invitation",
    description: "A person you invited accepted and joined the organization.",
    group: "Team",
  },
];

/** A person's email setting for every type: true unless they turned it off. */
export async function getEmailPreferences(userId: string): Promise<Record<NotificationType, boolean>> {
  const rows = await prisma.notificationPreference.findMany({ where: { userId }, select: { type: true, email: true } });
  const off = new Set(rows.filter((r) => !r.email).map((r) => r.type));
  return Object.fromEntries(Object.values(NotificationType).map((t) => [t, !off.has(t)])) as Record<
    NotificationType,
    boolean
  >;
}

/** Saves the settings it is given; types it is not given keep what they had. */
export async function setEmailPreferences(
  userId: string,
  changes: Array<{ type: NotificationType; email: boolean }>,
): Promise<Record<NotificationType, boolean>> {
  await prisma.$transaction(
    changes.map(({ type, email }) =>
      prisma.notificationPreference.upsert({
        where: { userId_type: { userId, type } },
        create: { userId, type, email },
        update: { email },
      }),
    ),
  );
  return getEmailPreferences(userId);
}

/** Of these recipients, the ones who turned this type's email off. */
export async function usersWithEmailOff(userIds: string[], type: NotificationType): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds }, type, email: false },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}
