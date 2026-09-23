import { test, expect } from "@playwright/test";

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
