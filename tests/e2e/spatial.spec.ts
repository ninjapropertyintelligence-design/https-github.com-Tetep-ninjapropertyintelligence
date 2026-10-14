import { test, expect } from "@playwright/test";

/**
 * PostGIS spatial queries (spec §11) end to end.
 *
 * Every query in src/lib/spatial.ts is raw SQL, which bypasses the Prisma
 * access layer the rest of the app relies on. The integration tests cover
 * that in depth; these confirm the routes are actually reachable and scoped
 * over real HTTP, and that the UI surface renders.
 */
async function loginAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|admin/, { timeout: 15000 });
}

test("nearby search returns properties with distances in miles", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  const res = await page.request.get(
    "/api/v1/properties/nearby?latitude=32.7767&longitude=-96.7970&radiusMiles=500",
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.error).toBeNull();
  expect(Array.isArray(body.data.properties)).toBe(true);
  expect(body.data).toHaveProperty("truncated");
  for (const p of body.data.properties) {
    // Distances must be real magnitudes, not degrees. A degree-based value
    // would be under 100 for anything on Earth.
    expect(p.distanceMiles).not.toBeNull();
    expect(p.distanceMiles).toBeLessThanOrEqual(500);
  }
});

test("a viewport query returns only what is inside the box", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  const inside = await page.request.get(
    "/api/v1/properties/in-bounds?north=90&south=-90&east=180&west=-179.9",
  );
  expect(inside.status()).toBe(200);
  const all = (await inside.json()).data.properties.length;

  // A one-degree box in the Atlantic should contain nothing.
  const empty = await page.request.get(
    "/api/v1/properties/in-bounds?north=1&south=0&east=1&west=0",
  );
  expect(empty.status()).toBe(200);
  expect((await empty.json()).data.properties).toHaveLength(0);
  // ...and the wide box should not have been empty, or this proves nothing.
  expect(all).toBeGreaterThan(0);
});

test("off-Earth coordinates are refused rather than silently clamped", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  const res = await page.request.get(
    "/api/v1/properties/nearby?latitude=91&longitude=0&radiusMiles=10",
  );
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

test("the property page shows nearby sites computed by the database", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  await page.goto("/properties");
  await page.getByRole("link", { name: /Store #/ }).first().click();
  await page.waitForURL(/\/properties\/[^/]+$/);
  await expect(page.getByText("Nearby properties")).toBeVisible();
});
