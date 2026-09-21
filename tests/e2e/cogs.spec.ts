import { test, expect } from "@playwright/test";

/**
 * Cost metering and property-level COGS (spec §49/§50) end to end.
 *
 * The API assertions here are not incidental. Every `sizeBytes` column is a
 * 64-bit BigInt (a 32-bit int caps one stored object at 2.147 GB, which drone
 * point clouds exceed), and `JSON.stringify` THROWS on a BigInt rather than
 * coercing it. TypeScript cannot see that — it is a runtime property of the
 * value — so only a real HTTP round trip proves the response serialises.
 */
async function loginAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|admin/, { timeout: 15000 });
}

test("Owner can open Cost to Serve, and it renders without fabricating costs", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  await page.goto("/reports/cogs");
  await expect(page.getByRole("heading", { name: "Cost to Serve", level: 1 })).toBeVisible();
  // Overhead is reported on its own rather than divided across properties.
  await expect(page.getByText("Organization overhead")).toBeVisible();
});

test("a role without financial visibility cannot reach Cost to Serve", async ({ page }) => {
  // Cost-to-serve is what the business pays, not what the customer is
  // charged, so it is gated separately from ordinary property access.
  await loginAs(page, "technician@demo.com");
  await page.goto("/reports/cogs");
  await expect(page).toHaveURL(/dashboard/);
});

test("the COGS API responds over HTTP with BigInt sizes serialised", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  const res = await page.request.get("/api/v1/organizations/cogs");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.error).toBeNull();
  expect(body.data).toHaveProperty("totalCostMicros");
  expect(body.data).toHaveProperty("unattributed");
});

test("a route returning a multi-gigabyte sizeBytes round-trips over HTTP", async ({ page }) => {
  await loginAs(page, "owner@demo.com");

  // The row has to be created first: an empty collection serialises fine with
  // or without the fix, so asserting on one would prove nothing.
  const properties = await page.request.get("/api/v1/properties");
  expect(properties.status()).toBe(200);
  const propertyId = (await properties.json()).data.items?.[0]?.id ?? (await properties.json()).data?.[0]?.id;
  expect(propertyId, "seeded org should have at least one property").toBeTruthy();

  // 5 GB — past the 2.147 GB ceiling the old 32-bit column imposed.
  const FIVE_GB = 5_000_000_000;
  const created = await page.request.post("/api/v1/evidence", {
    data: {
      type: "PHOTO",
      storageKey: `e2e/bigint-${Date.now()}.jpg`,
      sizeBytes: FIVE_GB,
      propertyId,
    },
  });
  // 201 from the route, preserved through withApiHandler's envelope.
  expect(created.status()).toBe(201);

  // Reading it back is what exercises JSON.stringify on a BigInt. Without
  // normalisation this throws "Do not know how to serialize a BigInt" and the
  // route returns a 500.
  const listed = await page.request.get(`/api/v1/evidence?propertyId=${propertyId}`);
  expect(listed.status()).toBe(200);
  const body = await listed.json();
  expect(body.error).toBeNull();
  const row = body.data.items.find((e: { sizeBytes: number }) => e.sizeBytes === FIVE_GB);
  expect(row, "the 5 GB row should survive the round trip exactly").toBeTruthy();
});
