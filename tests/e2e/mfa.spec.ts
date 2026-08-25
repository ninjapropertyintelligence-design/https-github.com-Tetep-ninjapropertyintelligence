import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { totp } from "@/lib/mfa";

/**
 * MFA end-to-end (spec §43) through the real login form and the real
 * settings UI — no mocking of the second factor, the codes are generated
 * from the secret the app actually issued.
 *
 * A dedicated user is created here rather than reusing a seeded demo
 * account: enabling MFA on `owner@demo.com` would change the state every
 * other spec logs in with, and a mid-test failure would leave it that way.
 */
const EMAIL = `e2e-mfa-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId: string;

test.beforeAll(async () => {
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const user = await prisma.user.create({
    data: { email: EMAIL, name: "MFA E2E User", passwordHash: await bcrypt.hash(PASSWORD, 10) },
  });
  userId = user.id;
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "FACILITIES_MANAGER" } });
});

test.afterAll(async () => {
  // Cascades remove the membership and any recovery codes.
  await prisma.user.deleteMany({ where: { id: userId } });
});

async function signIn(page: Page, code?: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  if (code !== undefined) {
    await page.waitForSelector('input[autocomplete="one-time-code"]');
    await page.fill('input[autocomplete="one-time-code"]', code);
    await page.click('button[type="submit"]');
  }
}

test("MFA: enrol, then the password alone no longer signs in", async ({ page }) => {
  await signIn(page);
  await page.waitForURL(/dashboard/, { timeout: 20000 });

  await page.goto("/settings/security");
  await expect(page.getByRole("heading", { name: "Two-Factor Authentication" })).toBeVisible();

  await page.getByRole("button", { name: /Set up two-factor/ }).click();

  // The setup key the app issued — codes below are derived from this, so
  // the test is exercising the same secret a real authenticator would hold.
  const secret = (await page.locator("p.font-mono").first().textContent())!.trim();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await expect(page.locator('a[href^="otpauth://"]')).toBeVisible();

  // A wrong code must not enable anything.
  await page.locator('input[autocomplete="one-time-code"]').fill("000000");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText(/not valid/i)).toBeVisible();

  await page.locator('input[autocomplete="one-time-code"]').fill(totp(secret));
  await page.getByRole("button", { name: "Turn on" }).click();

  await expect(page.getByText("Save these recovery codes now")).toBeVisible({ timeout: 15000 });
  const recoveryCodes = await page.locator("ul.font-mono li").allTextContents();
  expect(recoveryCodes).toHaveLength(10);

  // Sign out and prove the second factor is now actually required.
  await page.context().clearCookies();
  await signIn(page);
  await expect(page.locator('input[autocomplete="one-time-code"]')).toBeVisible({ timeout: 15000 });
  expect(page.url()).toContain("/login");

  await page.fill('input[autocomplete="one-time-code"]', "000000");
  await page.click('button[type="submit"]');
  await expect(page.getByText(/authentication code is not valid/i)).toBeVisible();

  await page.fill('input[autocomplete="one-time-code"]', totp(secret));
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });

  // A recovery code signs in once, and only once.
  await page.context().clearCookies();
  await signIn(page, recoveryCodes[0]);
  await page.waitForURL(/dashboard/, { timeout: 20000 });

  await page.context().clearCookies();
  await signIn(page, recoveryCodes[0]);
  await expect(page.getByText(/authentication code is not valid/i)).toBeVisible({ timeout: 15000 });

  // Turning it off requires the factor itself.
  await signIn(page, totp(secret));
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  await page.goto("/settings/security");
  await page.locator('input[autocomplete="one-time-code"]').fill(totp(secret));
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("Two-factor authentication is off.")).toBeVisible({ timeout: 15000 });
});
