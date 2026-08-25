import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";

/**
 * Admin impersonation end-to-end (spec §45). Each of the spec's five
 * requirements is asserted against the running app rather than the service
 * layer, because three of them (visible indicator, the customer's view of
 * the log, the off-switch actually stopping a live session) only exist once
 * the UI and the session resolution are wired together.
 */
test.afterEach(async () => {
  // A failure mid-test must not leave the demo org with support access off,
  // which would break every later run.
  await prisma.organization.updateMany({ data: { allowSupportAccess: true } });
});

async function loginAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
}

/** Next renders its own role="alert" route announcer; scope past it. */
const bannerOf = (page: import("@playwright/test").Page) =>
  page.getByRole("alert").filter({ hasText: "Support session" });

test("support session: visible, read-only, logged to the customer, and revocable by them", async ({ browser }) => {
  const reason = `Ticket #4821 — e2e check ${Date.now()}`;

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await loginAs(admin, "platformadmin@demo.com");
  await admin.waitForURL(/admin/, { timeout: 20000 });

  // 1. A reason is mandatory — the control is unusable without one.
  await expect(admin.getByRole("button", { name: "Start support session" })).toBeDisabled();

  await admin.fill('input[placeholder^="Ticket"]', reason);
  await admin.getByRole("button", { name: "Start support session" }).click();
  await admin.waitForURL(/dashboard/, { timeout: 20000 });

  // 2. Visible indicator, carrying the reason, on the page.
  await expect(bannerOf(admin)).toBeVisible({ timeout: 15000 });
  await expect(bannerOf(admin)).toContainText(reason);
  await expect(bannerOf(admin)).toContainText("Read-only");

  // 3. Support really is inside the customer's data...
  const read = await admin.request.get("/api/v1/properties");
  expect(read.status()).toBe(200);
  expect((await read.json()).data.items.length).toBeGreaterThan(0);

  // ...and cannot change any of it.
  const write = await admin.request.post("/api/v1/issues", {
    data: { title: "must not be created", propertyId: "x", severity: "LOW" },
  });
  expect(write.status()).toBe(403);
  expect((await write.json()).error).toMatch(/Read-only/);

  // 4. The indicator is on every page, not just where the session started.
  await admin.goto("/properties");
  await expect(bannerOf(admin)).toBeVisible();

  // 5. The customer can see it, and switch it off.
  const custCtx = await browser.newContext();
  const customer = await custCtx.newPage();
  await loginAs(customer, "owner@demo.com");
  await customer.waitForURL(/dashboard/, { timeout: 20000 });
  await customer.goto("/settings/security");

  await expect(customer.getByText("Platform support access")).toBeVisible({ timeout: 20000 });
  await expect(customer.getByText(reason)).toBeVisible();
  await expect(customer.getByText("In progress now")).toBeVisible();

  await customer.getByRole("button", { name: "Turn off support access" }).click();
  await expect(customer.getByText("Support access is turned off")).toBeVisible({ timeout: 15000 });

  // Revoking must stop the session already running, on the admin's very
  // next request — not merely prevent new ones.
  await admin.goto("/dashboard");
  await expect(bannerOf(admin)).toHaveCount(0);

  await customer.getByRole("button", { name: "Allow support access" }).click();
  await expect(customer.getByText("Support may view this account")).toBeVisible({ timeout: 15000 });

  // The normal exit works too.
  await admin.goto("/admin");
  await admin.fill('input[placeholder^="Ticket"]', `Ticket #4822 — exit path ${Date.now()}`);
  await admin.getByRole("button", { name: "Start support session" }).click();
  await admin.waitForURL(/dashboard/, { timeout: 20000 });
  await admin.getByRole("button", { name: "End session" }).click();
  await admin.waitForURL(/admin/, { timeout: 20000 });
  await expect(bannerOf(admin)).toHaveCount(0);

  await adminCtx.close();
  await custCtx.close();
});
