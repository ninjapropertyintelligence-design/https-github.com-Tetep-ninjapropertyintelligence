import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { setEmailProviderForTesting, type EmailMessage } from "@/lib/email";
import {
  assertResetRequestAllowed,
  isResetTokenValid,
  passwordProblem,
  requestPasswordReset,
  resetPassword,
} from "@/lib/password-reset-service";
import { sessionPredatesPasswordChange } from "@/lib/tenant-scope";
import { notifyUser } from "@/lib/notifications";
import { Role } from "@/generated/prisma/client";

/**
 * Forgot password. Each of these is a way a reset flow normally goes wrong:
 * telling strangers who has an account, links that work twice or forever,
 * and a reset that leaves the old password's sessions signed in.
 */

const suffix = `pr${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sent: EmailMessage[] = [];
let org: { id: string };
let user: { id: string; email: string };
let counter = 0;

/** A fresh address per test, so the in-memory rate limiter never carries over. */
function freshEmail(label: string) {
  counter += 1;
  return `${label}-${counter}-${suffix}@example.com`;
}

async function makeUser(email: string, isActive = true) {
  return prisma.user.create({
    data: { email, name: "Pat Example", passwordHash: await bcrypt.hash("old-password-123", 4), isActive },
  });
}

/** The token is only ever in the email; pull it out the way a person clicking would. */
function tokenFrom(message: EmailMessage): string {
  const match = message.text.match(/reset-password\?token=([A-Za-z0-9_\-%]+)/);
  if (!match) throw new Error("No reset link in email");
  return decodeURIComponent(match[1]);
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `PR ${suffix}`, slug: `pr-${suffix}` } });
});

beforeEach(async () => {
  sent = [];
  setEmailProviderForTesting({ name: "recording", send: async (m) => void sent.push(m) });
  user = await makeUser(freshEmail("user"));
});

afterEach(() => {
  setEmailProviderForTesting({ name: "silent", send: async () => {} });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
  await prisma.organization.delete({ where: { id: org.id } });
});

describe("requesting a reset", () => {
  it("emails a single-use link to an account that exists", async () => {
    await requestPasswordReset(user.email, "203.0.113.1");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(user.email);
    const token = tokenFrom(sent[0]);
    expect(await isResetTokenValid(token)).toBe(true);
  });

  it("matches the address however it was typed", async () => {
    await requestPasswordReset(`  ${user.email.toUpperCase()} `, null);
    expect(sent).toHaveLength(1);
  });

  it("stores only a hash of the token", async () => {
    await requestPasswordReset(user.email, null);
    const token = tokenFrom(sent[0]);
    const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).not.toContain(token);
  });

  it("sends nothing, and fails nothing, for an address with no account", async () => {
    await expect(requestPasswordReset(freshEmail("nobody"), null)).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("sends nothing to a deactivated account", async () => {
    const inactive = await makeUser(freshEmail("inactive"), false);
    await requestPasswordReset(inactive.email, null);
    expect(sent).toHaveLength(0);
  });

  it("kills the previous link when a new one is requested", async () => {
    await requestPasswordReset(user.email, null);
    await requestPasswordReset(user.email, null);
    const [first, second] = sent.map(tokenFrom);

    expect(await isResetTokenValid(first)).toBe(false);
    expect(await isResetTokenValid(second)).toBe(true);
  });

  it("limits how often one address can be sent a link", () => {
    const email = freshEmail("flood");
    for (let i = 0; i < 5; i += 1) assertResetRequestAllowed(email, null);
    expect(() => assertResetRequestAllowed(email, null)).toThrow(expect.objectContaining({ status: 429 }));
  });
});

describe("redeeming a link", () => {
  async function linkFor(email: string) {
    await requestPasswordReset(email, null);
    return tokenFrom(sent[sent.length - 1]);
  }

  it("sets the new password and records when it changed", async () => {
    const token = await linkFor(user.email);
    const before = Date.now();
    await resetPassword(token, "brand-new-password", null);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("brand-new-password", after.passwordHash)).toBe(true);
    expect(await bcrypt.compare("old-password-123", after.passwordHash)).toBe(false);
    expect(after.passwordChangedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("tells the account holder their password changed", async () => {
    const token = await linkFor(user.email);
    await resetPassword(token, "brand-new-password", null);
    expect(sent.at(-1)!.to).toBe(user.email);
    expect(sent.at(-1)!.subject).toMatch(/password was changed/i);
  });

  it("works only once", async () => {
    const token = await linkFor(user.email);
    await resetPassword(token, "brand-new-password", null);
    await expect(resetPassword(token, "another-password-1", null)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an expired link", async () => {
    const token = await linkFor(user.email);
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(resetPassword(token, "brand-new-password", null)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a made-up token", async () => {
    await expect(resetPassword("not-a-real-token", "brand-new-password", null)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("refuses a short password without spending the link", async () => {
    const token = await linkFor(user.email);
    await expect(resetPassword(token, "short", null)).rejects.toMatchObject({ status: 400 });
    expect(await isResetTokenValid(token)).toBe(true);
  });

  it("lets only one of two simultaneous submissions of a link win", async () => {
    const token = await linkFor(user.email);
    const results = await Promise.allSettled([
      resetPassword(token, "first-new-password", null),
      resetPassword(token, "second-new-password", null),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("signing out old sessions", () => {
  it("refuses a session that signed in before the password changed", () => {
    const changedAt = new Date("2026-10-01T12:00:00Z");
    expect(sessionPredatesPasswordChange(changedAt.getTime() - 1, changedAt)).toBe(true);
    expect(sessionPredatesPasswordChange(changedAt.getTime() + 1, changedAt)).toBe(false);
  });

  it("treats a session with no sign-in time as old once a password has changed", () => {
    expect(sessionPredatesPasswordChange(undefined, new Date())).toBe(true);
  });

  it("leaves every session alone for an account whose password never changed", () => {
    expect(sessionPredatesPasswordChange(undefined, null)).toBe(false);
  });
});

describe("password rules", () => {
  it("accepts a reasonable password", () => {
    expect(passwordProblem("correct horse battery")).toBeNull();
  });

  it("refuses one bcrypt would silently truncate", () => {
    expect(passwordProblem("x".repeat(73))).not.toBeNull();
  });
});

describe("notifications by email", () => {
  it("sends an email copy of an in-app notification, with a full link", async () => {
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: Role.OWNER } });
    await notifyUser({
      organizationId: org.id,
      userId: user.id,
      type: "ISSUE_ASSIGNED",
      title: "Assigned: Roof leak <north>",
      link: "/issues/abc",
    });

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(user.email);
    expect(sent[0].text).toMatch(/^https?:\/\/[^\s]+\/issues\/abc$/m);
    // A title is user input; it must not become markup.
    expect(sent[0].html).toContain("Roof leak &lt;north&gt;");
    expect(sent[0].html).not.toContain("<north>");
  });

  it("keeps the in-app notification when the email fails", async () => {
    setEmailProviderForTesting({
      name: "broken",
      send: async () => {
        throw new Error("mail is down");
      },
    });
    await notifyUser({ organizationId: org.id, userId: user.id, type: "REPORT_READY", title: "Report ready" });
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
  });
});
