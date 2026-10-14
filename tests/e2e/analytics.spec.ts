import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";

/**
 * Product analytics (spec §105) end to end.
 *
 * The unit and integration tests seed ProductEvent rows directly. Only a real
 * browser session proves the tracking calls on the page components actually
 * execute — a server component that silently failed to record would leave
 * every one of those tests green and the table empty.
 */
async function loginAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|admin/, { timeout: 15000 });
}

/**
 * ProductEvent rows accumulate across runs, and stale rows from a previous
 * run satisfy every assertion below regardless of whether tracking still
 * fires. An earlier version of this spec passed with the map tracking call
 * deleted, for exactly that reason.
 */
test.beforeEach(async () => {
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  await prisma.productEvent.deleteMany({ where: { organizationId: org.id } });
});

test("browsing the app records usage that shows up on the usage page", async ({ page }) => {
  await loginAs(page, "owner@demo.com");

  // Visit two tracked pages, then read the dashboard built from those rows.
  await page.goto("/map");
  await page.goto("/properties");
  await page.goto("/settings/usage");

  await expect(page.getByRole("heading", { name: "Product Usage", level: 1 })).toBeVisible();

  // Scoped to the adoption list specifically. Asserting on the page as a
  // whole would pass either way: the same feature names are also printed in
  // the "Not used at all" list, so an unscoped check proves nothing about
  // whether tracking fired.
  const adopted = page.getByTestId("feature-adoption");
  await expect(adopted.getByText("Portfolio map")).toBeVisible();
  await expect(adopted.getByText("Property list")).toBeVisible();
  // The login lands on the dashboard, so that view is recorded too.
  await expect(adopted.getByText("Dashboard", { exact: true })).toBeVisible();
  // ...and the same feature must NOT be listed as unused.
  await expect(page.getByTestId("unused-features")).not.toContainText("Portfolio map");
});

test("the usage page names features nobody used, not just the popular ones", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  await page.goto("/settings/usage");
  await expect(page.getByText("Not used at all")).toBeVisible();
});

test("a role without audit visibility cannot reach the usage page", async ({ page }) => {
  await loginAs(page, "technician@demo.com");
  await page.goto("/settings/usage");
  await expect(page).toHaveURL(/dashboard/);
});

test("the analytics API reports the window it could actually observe", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  const res = await page.request.get("/api/v1/organizations/analytics");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.error).toBeNull();
  // Rule 3: an absent figure must be distinguishable from a measured zero.
  expect(body.data.adoption.window).toHaveProperty("partialWindow");
  expect(body.data.adoption.window).toHaveProperty("trackingStartedAt");
  expect(body.data.adoption).toHaveProperty("unusedFeatures");
  expect(body.data.activeUsers).toHaveProperty("stickiness");
});
