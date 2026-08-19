import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 2 deep-property acceptance flow (spec §21): one real pilot property
 * (Store #1052, seeded by prisma/seed.ts) exercised end-to-end through every
 * major tab. External vendor behavior (Matterport, an AI provider) is never
 * mocked here — this environment genuinely has no MATTERPORT_API_TOKEN or
 * AI_PROVIDER key configured, so the assertions below intentionally cover
 * the honest NOT_CONFIGURED / "AI is not configured" degradation paths
 * rather than faking a connected/answered state. Run `npm run db:seed`
 * before this suite.
 */
async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', "owner@demo.com");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|admin/, { timeout: 15000 });
}

test("Deep property workflow: Store #1052 end-to-end across every tab", async ({ page }) => {
  await loginAsOwner(page);

  // Open Property -> Overview: shared header shows Health/Risk/Confidence/Exposure.
  await page.goto("/properties");
  await page.getByRole("link", { name: /Store #1052/ }).click();

  // Wait for the navigation to actually land before asserting. Without
  // this the first (cold-compile) run can still be on /properties when the
  // assertions below run — and "Health"/"Risk" also exist there as table
  // column headers, so the test would silently assert against the wrong
  // page instead of failing at the click.
  await page.waitForURL(/\/properties\/[^/?]+$/);
  await expect(page.getByRole("heading", { name: "Store #1052" })).toBeVisible();

  // Scope the stat labels to the property header specifically, so a
  // same-named column header elsewhere on the page can never satisfy them.
  const headerStats = page.locator("main").getByText(/^(Health|Risk|Confidence|Exposure)$/);
  for (const label of ["Health", "Risk", "Confidence", "Exposure"]) {
    await expect(headerStats.filter({ hasText: new RegExp(`^${label}$`) }).first()).toBeVisible();
  }

  const propertyUrl = page.url();
  const propertyId = new URL(propertyUrl).pathname.split("/").pop()!;

  // Interior: Matterport is genuinely unconfigured in this environment —
  // confirm the honest NOT_CONFIGURED state, not a faked connection.
  await page.goto(`/properties/${propertyId}?tab=interior`);
  await expect(page.getByText("Matterport is not configured")).toBeVisible();
  await expect(page.getByText("Provider:")).toBeVisible();

  // Exterior: real seeded drone dataset (two on-disk JPEGs) must render.
  await page.goto(`/properties/${propertyId}?tab=exterior`);
  await expect(page.getByText("Capture Summary")).toBeVisible();
  await expect(page.getByText(/Photos \(2\)/)).toBeVisible();

  // Assets -> open the canonical Asset detail page for RTU-04.
  await page.goto(`/properties/${propertyId}?tab=assets`);
  await page.getByRole("link", { name: "RTU-04" }).click();
  await expect(page.getByRole("heading", { name: "Condition History" })).toBeVisible();

  // Issues -> open the issue tied to RTU-04, created from the same asset.
  await page.goto(`/properties/${propertyId}?tab=issues`);
  await page.getByRole("link", { name: "RTU-04 compressor vibration" }).click();
  await expect(page.getByRole("heading", { name: "RTU-04 compressor vibration" })).toBeVisible();

  // Complete a fresh assessment via the real UI and confirm health recalculates.
  // Every JSON API response is {data, error, meta} (spec §63) — unwrap .data.
  const { snapshot: healthBefore } = (await page.request.get(`/api/v1/properties/${propertyId}/health`).then((r) => r.json())).data;

  const templatesRes = await page.request.get("/api/v1/assessments/templates");
  const { items: templates } = (await templatesRes.json()).data;
  const template = templates.find((t: { name: string }) => t.name === "Annual Property Assessment");
  expect(template).toBeTruthy();

  const createRes = await page.request.post("/api/v1/assessments", {
    data: { propertyId, templateId: template.id },
  });
  expect(createRes.ok()).toBeTruthy();
  const assessment = (await createRes.json()).data;

  await page.goto(`/assessments/${assessment.id}`);
  await expect(page.getByRole("button", { name: "Complete Assessment" })).toBeVisible();
  await page.getByRole("button", { name: "Complete Assessment" }).click();
  await expect(page.getByText(/completed and its answers are locked/i)).toBeVisible({ timeout: 15000 });

  const { snapshot: healthAfter } = (await page.request.get(`/api/v1/properties/${propertyId}/health`).then((r) => r.json())).data;
  expect(healthAfter.computedAt).not.toBe(healthBefore.computedAt);

  // Ask AI, scoped to this property — no provider key is configured here,
  // so the honest degradation message is the correct outcome to verify.
  await page.goto(`/properties/${propertyId}?tab=ai`);
  await page.getByPlaceholder(/wrong with this property/i).fill("What is wrong with this property?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("AI is not configured in this environment", { exact: false }).first()).toBeVisible({ timeout: 15000 });

  // Generate Property Report (PDF) — confirm a real PDF is produced from real data.
  const reportRes = await page.request.get(`/api/v1/reports/property-condition?propertyId=${propertyId}&format=pdf`);
  expect(reportRes.ok()).toBeTruthy();
  expect(reportRes.headers()["content-type"]).toContain("application/pdf");
  const pdfBytes = await reportRes.body();
  expect(pdfBytes.byteLength).toBeGreaterThan(500);
  expect(pdfBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
});
