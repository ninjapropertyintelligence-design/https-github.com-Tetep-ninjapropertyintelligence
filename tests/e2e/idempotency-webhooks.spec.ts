import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";

/**
 * Idempotency (§65) and webhooks (§66) through the running app.
 *
 * The idempotency case is the one that can only be proven here: the header
 * has to survive `withApiHandler` re-wrapping the request body (it reads the
 * body to hash it, and a Request body can be read only once). A unit test of
 * the library would pass even if that rewrap dropped the payload.
 */
const STAMP = Date.now();
const KEY = `e2e-idem-${STAMP}`;

test.afterAll(async () => {
  await prisma.issue.deleteMany({ where: { title: { contains: String(STAMP) } } });
  await prisma.idempotencyKey.deleteMany({ where: { key: { contains: String(STAMP) } } });
  await prisma.webhookEndpoint.deleteMany({ where: { description: { contains: String(STAMP) } } });
});

test("idempotency: a repeated key replays the original response instead of creating a duplicate", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', "owner@demo.com");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });

  const properties = (await (await page.request.get("/api/v1/properties")).json()).data.items;
  const propertyId = properties[0].id;
  const before = (await (await page.request.get("/api/v1/issues")).json()).data.items.length;

  const payload = { propertyId, title: `E2E idempotency ${STAMP}`, severity: "LOW" };

  const first = await page.request.post("/api/v1/issues", { data: payload, headers: { "Idempotency-Key": KEY } });
  expect(first.status()).toBe(201);
  const firstId = (await first.json()).data.id;
  expect(firstId).toBeTruthy();

  const second = await page.request.post("/api/v1/issues", { data: payload, headers: { "Idempotency-Key": KEY } });
  expect(second.status()).toBe(201);
  expect(second.headers()["idempotency-replayed"]).toBe("true");
  // The ORIGINAL response, not a second creation.
  expect((await second.json()).data.id).toBe(firstId);

  const after = (await (await page.request.get("/api/v1/issues")).json()).data.items.length;
  expect(after).toBe(before + 1);

  // Same key, different body: a client bug, reported rather than replayed.
  const mismatched = await page.request.post("/api/v1/issues", {
    data: { ...payload, title: `E2E idempotency ${STAMP} CHANGED` },
    headers: { "Idempotency-Key": KEY },
  });
  expect(mismatched.status()).toBe(422);

  // The body still reaches the handler when a key IS supplied — the rewrap
  // is the part a library-only test cannot cover.
  const keyed = await page.request.post("/api/v1/issues", {
    data: { propertyId, title: `E2E body survives ${STAMP}`, severity: "LOW" },
    headers: { "Idempotency-Key": `${KEY}-b` },
  });
  expect(keyed.status()).toBe(201);
  expect((await keyed.json()).data.title).toBe(`E2E body survives ${STAMP}`);
});

test("webhooks: endpoints register with a one-time secret, and unsafe URLs are refused", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', "owner@demo.com");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });

  await page.goto("/settings/webhooks");
  await expect(page.getByRole("heading", { name: "Add an endpoint" })).toBeVisible({ timeout: 25000 });

  // A customer-supplied URL we then fetch is an SSRF vector; both of these
  // must be refused before anything is stored.
  for (const [url, pattern] of [
    ["http://example.com/hook", /https/],
    ["https://127.0.0.1/hook", /private or loopback/],
  ] as const) {
    const refused = await page.request.post("/api/v1/webhooks/endpoints", { data: { url } });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error).toMatch(pattern);
  }

  const created = await page.request.post("/api/v1/webhooks/endpoints", {
    data: { url: "https://example.com/e2e-hook", description: `e2e ${STAMP}`, eventTypes: ["issue.created"] },
  });
  expect(created.status()).toBe(201);
  const { id, secret } = (await created.json()).data;
  expect(secret).toMatch(/^whsec_/);

  // The secret is write-only: it must never come back from a read.
  const listed = await page.request.get("/api/v1/webhooks/endpoints");
  expect(await listed.text()).not.toContain(secret);

  // Creating an issue fans out to the endpoint automatically.
  const properties = (await (await page.request.get("/api/v1/properties")).json()).data.items;
  await page.request.post("/api/v1/issues", {
    data: { propertyId: properties[0].id, title: `E2E webhook trigger ${STAMP}`, severity: "LOW" },
  });

  const deliveries = (await (await page.request.get(`/api/v1/webhooks/deliveries?endpointId=${id}`)).json()).data.items;
  expect(deliveries.length).toBeGreaterThanOrEqual(1);
  expect(deliveries[0].eventType).toBe("issue.created");

  await page.reload();
  await expect(page.getByText("https://example.com/e2e-hook")).toBeVisible();
});
