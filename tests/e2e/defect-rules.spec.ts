import { test, expect } from "@playwright/test";

/**
 * The defect rulebook settings page. What it edits decides the repair cost
 * and condition hit of every confirmed AI finding, so the tests cover who may
 * change it as much as whether a change sticks.
 */
async function loginAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|admin/, { timeout: 15000 });
}

test("an Owner customizes a rule, sees it saved, and resets it to the default", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  // Leave the shared seeded database as found, whatever a previous run did.
  await page.request.delete("/api/v1/defect-rules?defectClass=pavement_pothole");

  await page.goto("/settings/defect-rules");
  await expect(page.getByRole("heading", { name: "Defect Rules", level: 1 })).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: "pavement_pothole" });
  await expect(row.getByText("Platform default")).toBeVisible();
  // The platform ships no repair costs; it says so instead of showing one.
  await expect(row.getByText("Not set")).toBeVisible();
  await row.getByRole("button", { name: "Edit" }).click();
  await row.getByLabel("Condition points").fill("18");
  await row.getByLabel("Repair estimate in dollars").fill("3250");
  await row.getByRole("button", { name: "Save" }).click();

  await expect(row.getByText("Customized")).toBeVisible();
  await expect(row.getByRole("cell", { name: "−18", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "$3K", exact: true })).toBeVisible();
  // The API agrees with the page.
  const { data: rules } = (await (await page.request.get("/api/v1/defect-rules")).json()) as {
    data: Array<{ defectClass: string; conditionHit: number; repairCostCents: number }>;
  };
  expect(rules.find((r) => r.defectClass === "pavement_pothole")).toMatchObject({ conditionHit: 18, repairCostCents: 325_000 });

  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Reset" }).click();
  await expect(row.getByText("Platform default")).toBeVisible();
  await expect(row.getByText("Not set")).toBeVisible();
});

test("a Viewer can read the rulebook but not change it", async ({ page }) => {
  await loginAs(page, "viewer@demo.com");
  await page.goto("/settings/defect-rules");
  await expect(page.getByText("Only an Owner or Portfolio Admin can change them.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  const res = await page.request.put("/api/v1/defect-rules", {
    data: { defectClass: "pavement_pothole", category: "ExteriorParking", defaultSeverity: "LOW", conditionHit: 1, repairCostCents: 1 },
  });
  expect(res.status()).toBe(403);
});

test("a role without financial visibility cannot reach the rulebook", async ({ page }) => {
  await loginAs(page, "technician@demo.com");
  await page.goto("/settings/defect-rules");
  await expect(page).toHaveURL(/dashboard/);
});

test("an Owner switches automatic photo analysis off and back on", async ({ page }) => {
  await loginAs(page, "owner@demo.com");
  await page.goto("/settings/defect-rules");
  const toggle = page.getByRole("switch", { name: "Analyse vendor photos automatically" });
  const before = await toggle.getAttribute("aria-checked");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", before ?? "true");
});

test("a Viewer cannot change automatic photo analysis", async ({ page }) => {
  await loginAs(page, "viewer@demo.com");
  await page.goto("/settings/defect-rules");
  await expect(page.getByRole("switch", { name: "Analyse vendor photos automatically" })).toBeDisabled();
  const res = await page.request.put("/api/v1/photo-analysis/settings", { data: { autoAnalyzePhotos: false } });
  expect(res.status()).toBe(403);
});
