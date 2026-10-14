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

/**
 * Three dashboards, not eight. These assertions changed with the design: the
 * Executive / Portfolio Operations / Regional / Facilities / Field Work
 * variants collapsed into one Operations screen, and the owner-facing view
 * kept the portfolio numbers.
 */
test("Owner sees the portfolio numbers AND the operations half on one screen", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  // Both halves, which is the point of the consolidation: what the portfolio
  // is worth, and what is running against it.
  await expect(page.getByText("PORTFOLIO HEALTH")).toBeVisible();
  await expect(page.getByText("12-MONTH EXPOSURE")).toBeVisible();
  await expect(page.getByText("Subcontractors")).toBeVisible();
  await expect(page.getByText("Jobs in flight")).toBeVisible();
});

test("Read-only stakeholder sees condition and exposure, never the crew roster", async ({ page }) => {
  await loginAs(page, "viewer@demo.com");
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await expect(page.getByText("TOTAL PROPERTIES")).toBeVisible();
  // The separation that matters: a lender or insurer is not shown who was
  // hired, what they were paid to do, or where they last uploaded from.
  await expect(page.getByText("Subcontractors")).toHaveCount(0);
  await expect(page.getByText("Jobs in flight")).toHaveCount(0);
});

test("Field staff get operations without the portfolio roll-up", async ({ page }) => {
  await loginAs(page, "inspector@demo.com");
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  // Withheld because an Inspector holds no financial permission — and not
  // merely hidden: the service never fetches it for them.
  await expect(page.getByText("12-MONTH EXPOSURE")).toHaveCount(0);
  await expect(page.getByText("PORTFOLIO HEALTH")).toHaveCount(0);
});

test("Internal staff land on Operations with jobs and the subcontractor roster", async ({ page }) => {
  await loginAs(page, "facilitiesmanager@demo.com");
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  await expect(page.getByText("Capture work in flight, and who is on it")).toBeVisible();
  await expect(page.getByText("Subcontractors")).toBeVisible();
  // The seeded demo job is issued to ABC Roofing, and the vendor's name has
  // to appear in both places for the page to do its job: on the job line
  // ("who is on this") and on the roster ("who have we got"). Asserted
  // separately because a bare text match is ambiguous across the two.
  await expect(page.getByText(/ABC Roofing · \d+ of \d+ sites/)).toBeVisible();
  await expect(page.getByText("ABC Roofing", { exact: true })).toBeVisible();
  await expect(page.getByText("Executive Dashboard")).toHaveCount(0);
});

test("Operations shows the route progress for a seeded job's site", async ({ page }) => {
  await loginAs(page, "portfolioadmin@demo.com");
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  // The demo job carries six positions on Store #1052. Progress is rendered
  // from linked evidence, so the denominator proves the shot list reached
  // this screen rather than just the job detail page.
  await expect(page.getByText(/route \d+\/6/)).toBeVisible();
});

test("Vendor sees only assigned work, no portfolio/finance nav", async ({ page }) => {
  await loginAs(page, "vendor@demo.com");
  await expect(page.getByText("Assigned work only")).toBeVisible();
  await expect(page.getByRole("link", { name: "Reports" })).toHaveCount(0);
  // Their capture job, which is their actual work — this dashboard listed
  // only issues before, so a subcontractor on a capture sweep saw nothing.
  await expect(page.getByText("Q4 condition sweep — Midwest")).toBeVisible();
  await expect(page.getByText("Sites to deliver")).toBeVisible();
  // And never the roster: a subcontractor must not see who else is engaged.
  await expect(page.getByText("Subcontractors")).toHaveCount(0);
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
  // Scoped to the answer region. A page-wide text match also hits the
  // suggestion chip and the recent-query list, both of which echo the question
  // verbatim — so the assertion passed or failed on how many prior queries
  // happened to be logged, not on whether an answer appeared.
  const answer = page.getByTestId("ai-answer");
  await expect(answer).toBeVisible({ timeout: 15000 });
  await expect(answer).toContainText(/AI is not configured|worst propert/i);
});
