import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";

/**
 * Retention and secure deletion end-to-end (spec §52/§54).
 *
 * This spec creates and destroys its own property. An earlier manual run of
 * the same flow against the seeded Store #1052 permanently deleted it and
 * broke the deep-property spec — a deletion feature has no undo, so its
 * tests must not point at shared fixtures.
 */
const NAME = `E2E Retention Property ${Date.now()}`;
let propertyId: string;
let orgId: string;

test.beforeAll(async () => {
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  orgId = org.id;
  const portfolio = await prisma.portfolio.findFirstOrThrow({ where: { organizationId: org.id } });
  const property = await prisma.property.create({
    data: {
      organizationId: org.id,
      portfolioId: portfolio.id,
      name: NAME,
      addressLine1: "1 Disposable Way",
      city: "Testville",
      state: "TX",
      postalCode: "75001",
    },
  });
  propertyId = property.id;
});

test.afterAll(async () => {
  // Deleted by the test itself on the happy path; this covers a failure
  // partway through, and clears the policy/holds it created.
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.legalHold.deleteMany({ where: { organizationId: orgId } });
  await prisma.deletionRequest.deleteMany({ where: { organizationId: orgId } });
  await prisma.retentionPolicy.deleteMany({ where: { organizationId: orgId } });
});

test("retention: a legal hold blocks deletion, and a real deletion reports all six surfaces", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', "owner@demo.com");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });

  await page.goto("/settings/retention");
  await expect(page.getByRole("heading", { name: "Retention policy" })).toBeVisible({ timeout: 25000 });

  // Spec §52 names seven policy categories; six are durations set here (the
  // seventh, legal hold, is the section below).
  for (const label of [
    "Active property",
    "Deleted property",
    "Deleted organization",
    "Archived capture",
    "Customer termination",
    "Backup expiration",
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  // Zero grace so the deletion is immediately due.
  await page.locator('input[type="number"]').nth(1).fill("0");
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByText("Retention policy saved.")).toBeVisible({ timeout: 15000 });

  // A legal hold must stop a deletion outright.
  await page.locator('input[placeholder="Litigation 2026-14"]').fill("E2E hold — litigation");
  await page.getByRole("button", { name: "Place hold" }).click();
  await expect(page.getByText("Legal hold placed.")).toBeVisible({ timeout: 15000 });

  await page.locator("select").last().selectOption(propertyId);
  await page.locator('input[placeholder="Store closed permanently"]').fill("E2E deletion check");
  await page.getByRole("button", { name: "Schedule deletion" }).click();
  await expect(page.getByText(/legal hold/i).first()).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Release" }).first().click();
  await expect(page.getByText("Legal hold released.")).toBeVisible({ timeout: 15000 });

  await page.locator("select").last().selectOption(propertyId);
  await page.locator('input[placeholder="Store closed permanently"]').fill("E2E deletion check");
  await page.getByRole("button", { name: "Schedule deletion" }).click();
  await expect(page.getByText("Deletion scheduled.")).toBeVisible({ timeout: 15000 });

  // Run the job as the platform admin, in a separate context.
  const adminPage = await page.context().browser()!.newPage();
  await adminPage.goto("/login");
  await adminPage.fill('input[type="email"]', "platformadmin@demo.com");
  await adminPage.fill('input[type="password"]', "password123");
  await adminPage.click('button[type="submit"]');
  await adminPage.waitForURL(/admin/, { timeout: 20000 });

  const run = await adminPage.request.post("/api/v1/admin/retention/run");
  expect(run.status()).toBe(200);
  const body = (await run.json()).data;
  expect(body.executed).toBeGreaterThanOrEqual(1);
  await adminPage.close();

  // The customer's record shows an outcome per surface — including the two
  // that honestly are not "done", which a single "deleted" flag would hide.
  await page.reload();
  await expect(page.getByText("Object storage")).toBeVisible({ timeout: 20000 });
  for (const surface of ["Database", "Object storage", "Search index", "Derived files", "Cache", "Backup retention"]) {
    await expect(page.getByText(surface, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("NOT_APPLICABLE").first()).toBeVisible();
  await expect(page.getByText("SCHEDULED").first()).toBeVisible();
  await expect(page.getByText(/Backups cannot be selectively purged/)).toBeVisible();

  // And the property is genuinely gone, not hidden.
  expect(await prisma.property.findUnique({ where: { id: propertyId } })).toBeNull();
  await page.goto("/properties");
  await expect(page.getByText(NAME)).toHaveCount(0);
});
