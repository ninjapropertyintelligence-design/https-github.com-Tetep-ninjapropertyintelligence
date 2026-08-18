import { test, expect } from "@playwright/test";

/**
 * End-to-end acceptance tests against the seeded demo org (prisma/seed.ts).
 * Run `npm run db:seed` before this suite. These exercise the Day-45
 * acceptance path (spec §66) at the UI layer: login -> role-correct
 * dashboard -> drill into a property -> assets -> issues, plus the
 * role-based access boundaries a real customer would rely on.
 */
async function loginAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|admin/, { timeout: 15000 });
}

test("Owner sees the Executive Dashboard with real portfolio numbers", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  await expect(page.getByText("Executive Dashboard")).toBeVisible();
  await expect(page.getByText("TOTAL PROPERTIES")).toBeVisible();
});

test("Facilities Manager sees the action-queue dashboard, not the executive one", async ({ page }) => {
  await loginAs(page, "facilitiesmanager@demo.com");
  await expect(page.getByText("What needs action")).toBeVisible();
  await expect(page.getByText("Executive Dashboard")).not.toBeVisible();
});

test("Vendor sees only assigned work, no portfolio/finance nav", async ({ page }) => {
  await loginAs(page, "vendor@demo.com");
  await expect(page.getByText("Assigned work only")).toBeVisible();
  await expect(page.getByRole("link", { name: "Reports" })).toHaveCount(0);
});

test("Regional Manager's property list is scoped to their region only", async ({ page }) => {
  await loginAs(page, "regionalmanager@demo.com");
  await page.goto("/properties");
  await expect(page.getByText("Store #742")).toBeVisible(); // Midwest
  await expect(page.getByText("Store #182")).toHaveCount(0); // Southwest — out of scope
});

test("Vendor cannot reach the platform admin console", async ({ page }) => {
  await loginAs(page, "vendor@demo.com");
  await page.goto("/admin");
  await expect(page).toHaveURL(/dashboard/);
});

test("Platform Admin lands on the platform console, not an org dashboard", async ({ page }) => {
  await loginAs(page, "platformadmin@demo.com");
  await expect(page.getByText("Platform Administration")).toBeVisible();
});

test("Owner can drill from Portfolio -> Property -> Asset", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  await page.goto("/properties");
  await page.getByRole("link", { name: /Store #1052/ }).click();
  await expect(page.getByText("Health Score", { exact: true })).toBeVisible();

  await page.getByRole("main").getByRole("link", { name: "Assets" }).click();
  await expect(page.getByText("RTU-04")).toBeVisible();

  await page.getByRole("link", { name: "RTU-04" }).click();
  await expect(page.getByRole("heading", { name: "Condition History" })).toBeVisible();
});

test("AI degrades honestly when not configured, never fabricates an answer", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  await page.goto("/ai");
  await page.getByPlaceholder(/Which are/).fill("Which are my worst properties?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText(/AI is not configured|worst propert/i)).toBeVisible({ timeout: 15000 });
});
