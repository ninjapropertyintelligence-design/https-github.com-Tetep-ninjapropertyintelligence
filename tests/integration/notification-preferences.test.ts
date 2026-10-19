import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { NotificationType, Role } from "@/generated/prisma/client";
import { setEmailProviderForTesting, type EmailMessage } from "@/lib/email";
import {
  NOTIFICATION_CATALOG,
  getEmailPreferences,
  setEmailPreferences,
} from "@/lib/notification-preferences";
import { notifyCaptureReviewers, notifyUser } from "@/lib/notifications";

/**
 * Email preferences. The failure modes worth guarding: an opt-out that also
 * hides the in-app notification (so someone misses something), an opt-out
 * that leaks to another person, and a new notification type that nobody
 * added to the settings page and so can never be turned off.
 */

const suffix = `np${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sent: EmailMessage[] = [];
let org: { id: string };
let alice: { id: string; email: string };
let bob: { id: string; email: string };

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `NP ${suffix}`, slug: `np-${suffix}` } });
  alice = await prisma.user.create({ data: { email: `alice-${suffix}@example.com`, name: "Alice", passwordHash: "x" } });
  bob = await prisma.user.create({ data: { email: `bob-${suffix}@example.com`, name: "Bob", passwordHash: "x" } });
  for (const user of [alice, bob]) {
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: Role.PORTFOLIO_ADMIN } });
  }
});

beforeEach(async () => {
  sent = [];
  setEmailProviderForTesting({ name: "recording", send: async (m) => void sent.push(m) });
  await prisma.notificationPreference.deleteMany({ where: { userId: { in: [alice.id, bob.id] } } });
  await prisma.notification.deleteMany({ where: { organizationId: org.id } });
});

afterEach(() => {
  setEmailProviderForTesting({ name: "silent", send: async () => {} });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
});

describe("the settings page's list", () => {
  it("covers every notification type exactly once", () => {
    // A type missing here could be sent but never turned off.
    const listed = NOTIFICATION_CATALOG.map((c) => c.type).sort();
    expect(listed).toEqual([...Object.values(NotificationType)].sort());
  });
});

describe("reading and saving", () => {
  it("has every email on for someone who never changed anything", async () => {
    const prefs = await getEmailPreferences(alice.id);
    expect(Object.values(prefs).every(Boolean)).toBe(true);
  });

  it("turns off only what was turned off", async () => {
    const prefs = await setEmailPreferences(alice.id, [{ type: "ISSUE_ASSIGNED", email: false }]);
    expect(prefs.ISSUE_ASSIGNED).toBe(false);
    expect(prefs.ISSUE_CRITICAL).toBe(true);
  });

  it("can turn an email back on", async () => {
    await setEmailPreferences(alice.id, [{ type: "ISSUE_ASSIGNED", email: false }]);
    const prefs = await setEmailPreferences(alice.id, [{ type: "ISSUE_ASSIGNED", email: true }]);
    expect(prefs.ISSUE_ASSIGNED).toBe(true);
  });

  it("keeps one person's choice to themselves", async () => {
    await setEmailPreferences(alice.id, [{ type: "ISSUE_ASSIGNED", email: false }]);
    expect((await getEmailPreferences(bob.id)).ISSUE_ASSIGNED).toBe(true);
  });
});

describe("delivery", () => {
  it("skips the email but still delivers the in-app notification", async () => {
    await setEmailPreferences(alice.id, [{ type: "ISSUE_ASSIGNED", email: false }]);
    await notifyUser({ organizationId: org.id, userId: alice.id, type: "ISSUE_ASSIGNED", title: "Assigned: Roof leak" });

    expect(sent).toHaveLength(0);
    expect(await prisma.notification.count({ where: { userId: alice.id, type: "ISSUE_ASSIGNED" } })).toBe(1);
  });

  it("still emails the types left on", async () => {
    await setEmailPreferences(alice.id, [{ type: "ISSUE_ASSIGNED", email: false }]);
    await notifyUser({ organizationId: org.id, userId: alice.id, type: "ISSUE_CRITICAL", title: "Critical: Roof leak" });
    expect(sent.map((m) => m.to)).toEqual([alice.email]);
  });

  it("applies each recipient's own choice when one notification goes to several", async () => {
    await setEmailPreferences(alice.id, [{ type: "CAPTURE_SUBMITTED", email: false }]);
    await notifyCaptureReviewers({ organizationId: org.id, type: "CAPTURE_SUBMITTED", title: "Capture ready for review" });

    expect(sent.map((m) => m.to)).toEqual([bob.email]);
    expect(await prisma.notification.count({ where: { organizationId: org.id, type: "CAPTURE_SUBMITTED" } })).toBe(2);
  });

  it("tells the recipient where to change it", async () => {
    await notifyUser({ organizationId: org.id, userId: bob.id, type: "REPORT_READY", title: "Report ready" });
    expect(sent[0].text).toMatch(/\/settings\/notifications/);
    expect(sent[0].html).toContain("/settings/notifications");
  });
});
