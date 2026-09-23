import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * The subcontractor's view of a capture job, through the real UI.
 *
 * The integration tests pin the access rule and the deliverable accounting
 * precisely. What this covers is the part they cannot: that a vendor signing
 * in actually reaches the work, and that the refusal to submit an incomplete
 * site arrives as a message a human can act on rather than a silent failure.
 *
 * Run `npm run db:seed` first — the job is seeded and issued to ABC Roofing.
 */
test("a capture vendor sees their job and is told what the site still owes", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', "vendor@demo.com");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|issues|capture-jobs/, { timeout: 15000 });

  await page.goto("/capture-jobs");
  const jobLink = page.getByRole("link", { name: /Q4 condition sweep/ });
  await expect(jobLink).toBeVisible();
  await jobLink.click();

  await page.waitForURL(/\/capture-jobs\/[^/?]+$/);
  await expect(page.getByRole("heading", { name: /Q4 condition sweep/ })).toBeVisible();

  // The deliverables are listed as their own chips, so the vendor can see
  // what the job asks for before doing any of it.
  await expect(page.getByText(/condition scores/i).first()).toBeVisible();

  // Submitting an incomplete site must fail with the missing items named.
  // "Incomplete" alone would send a subcontractor back to guess.
  await page.getByRole("button", { name: /Submit site/i }).click();
  await expect(page.getByText(/still owes/i)).toBeVisible({ timeout: 10000 });
});


/** How many panoramas this property already has, read through the API. */
async function countPanoramas(page: Page, propertyId: string): Promise<number> {
  const res = await page.request.get(`/api/v1/evidence?propertyId=${propertyId}`);
  expect(res.ok()).toBe(true);
  const items = (await res.json()).data.items as Array<{ type: string }>;
  return items.filter((i) => i.type === "IMAGE_360").length;
}

/**
 * The upload panel, driven as a subcontractor would.
 *
 * Every layer under this is covered by integration tests. What only a browser
 * proves is that the three-step dance actually works from a real page: signed
 * URLs minted, bytes PUT straight to storage, then one batched registration.
 */
test("a capture vendor uploads panoramas from the job page", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', "vendor@demo.com");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|issues|capture-jobs/, { timeout: 15000 });

  await page.goto("/capture-jobs");
  await page.getByRole("link", { name: /Q4 condition sweep/ }).click();
  await page.waitForURL(/\/capture-jobs\/[^/?]+$/);

  // The site's own link carries the property id the panel uploads against.
  const href = await page.locator('a[href^="/properties/"]').first().getAttribute("href");
  const propertyId = href!.split("/").pop()!;
  const before = await countPanoramas(page, propertyId);

  await page.locator("select[id^='kind-']").first().selectOption("IMAGE_360");

  // A tiny but real JPEG: the smallest thing the server will accept as bytes.
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  );

  await page.setInputFiles('input[type="file"]', [
    { name: `e2e-${randomUUID()}.jpg`, mimeType: "image/jpeg", buffer: jpeg },
    { name: `e2e-${randomUUID()}.jpg`, mimeType: "image/jpeg", buffer: jpeg },
  ]);

  // The panel reports what landed. Asserting on the count rather than a
  // spinner, because a silent no-op would also make a spinner disappear.
  await expect(page.getByText(/2 files uploaded/i)).toBeVisible({ timeout: 30000 });

  // And two more panoramas exist than before.
  //
  // Counted rather than asserted on the deliverable chip, because this test
  // writes to seeded data that survives the run: on a second run the chip
  // would already be ticked and the assertion would pass whether or not this
  // upload did anything. A delta is true on every run.
  const after = await countPanoramas(page, propertyId);
  expect(after).toBe(before + 2);
});
