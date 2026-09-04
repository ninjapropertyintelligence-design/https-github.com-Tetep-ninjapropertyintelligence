import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";

/**
 * Bulk import end-to-end (spec §68/§69) through the real wizard.
 *
 * The file deliberately contains the spec's own duplicate example plus the
 * mistakes real spreadsheets carry — a bad state code, a bad ZIP, a full
 * state name, a leading-zero ZIP — because the point of the preview step is
 * that a messy file is understood before it is applied.
 */
const STAMP = Date.now();
const NAMES = [`E2E Store ${STAMP}`, `E2E Hoboken ${STAMP}`];

test.afterAll(async () => {
  await prisma.property.deleteMany({ where: { name: { in: [NAMES[0], NAMES[1], `${NAMES[0]}-x`] } } });
  await prisma.importJob.deleteMany({ where: { originalFilename: `e2e-${STAMP}.csv` } });
});

test("import: preview shows duplicates and errors, commit applies, undo reverses it", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', "owner@demo.com");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });

  const before = (await (await page.request.get("/api/v1/properties")).json()).data.items.length;

  await page.goto("/imports");
  await expect(page.getByText("1. Upload a file")).toBeVisible({ timeout: 25000 });

  // Rows 1-3 are the spec's three spellings of one store; 4 is new;
  // 5 and 6 are broken.
  const csv = [
    "Store Name,Store Number,Address,City,State,Zip,Year Built,Notes",
    `${NAMES[0]},,1200 E2E St,Springfield,TX,75201,1998,original`,
    `${NAMES[0].replace("Store", "Store #")},,1200 E2E Street Suite 4,Springfield,TX,75201,1998,dup`,
    `${NAMES[0].replace(" ", "-")},,1200 E2E St,Springfield,TX,75201,1998,dup`,
    `${NAMES[1]},E2E-7001,1 River St,Hoboken,New Jersey,07030,1990,leading zero`,
    `E2E Bad State ${STAMP},E2E-7002,9 Elm St,Nowhere,ZZ,75201,1998,bad state`,
    `E2E Bad Zip ${STAMP},E2E-7003,10 Elm St,Dallas,TX,ABCDE,1998,bad zip`,
  ].join("\n");

  await page.setInputFiles('input[type="file"]', {
    name: `e2e-${STAMP}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Upload and preview" }).click();

  // --- Preview (spec §68) ---
  await expect(page.getByText("2. Match your columns")).toBeVisible({ timeout: 25000 });
  await expect(page.getByText("3. Review what will happen")).toBeVisible();

  // Duplicate detection: the three spellings collapse to one create + two dupes.
  await expect(page.getByRole("cell", { name: "Duplicate", exact: true })).toHaveCount(2);
  // Validation: both broken rows are flagged with a reason, not just a count.
  await expect(page.getByText(/is not a US state/)).toBeVisible();
  await expect(page.getByText(/is not a 5-digit ZIP code/)).toBeVisible();

  // Nothing may be written by a preview.
  const during = (await (await page.request.get("/api/v1/properties")).json()).data.items.length;
  expect(during).toBe(before);

  // Error report is a real CSV, not the JSON envelope.
  const errorsHref = await page.locator('a[href*="/errors"]').getAttribute("href");
  // This import's own job id, so the undo assertion below waits on THIS job
  // rather than on any "ROLLED_BACK" text that an earlier import left on the
  // page — which is exactly how the first version of this test passed
  // instantly without waiting for anything.
  const jobId = errorsHref!.split("/").at(-2)!;
  const errors = await page.request.get(errorsHref!);
  expect(errors.headers()["content-type"]).toContain("text/csv");
  const errorCsv = await errors.text();
  expect(errorCsv).toContain("is not a US state");
  expect(errorCsv.split("\n")[0]).toBe("row,column,field,value,problem");

  // --- Commit ---
  await page.getByRole("button", { name: /^Import \d+ rows$/ }).click();
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 30000 });

  const afterItems = (await (await page.request.get("/api/v1/properties")).json()).data.items;
  // Two created: one canonical store (not three) plus Hoboken. The two
  // broken rows and the two duplicate spellings are not.
  expect(afterItems.length).toBe(before + 2);
  const created = afterItems.filter((p: { name: string }) => p.name.includes(String(STAMP)));
  expect(created).toHaveLength(2);

  // The leading-zero ZIP survived as text rather than becoming 7030.
  const hoboken = created.find((p: { name: string }) => p.name === NAMES[1]);
  expect(hoboken.postalCode).toBe("07030");

  // --- Undo (spec §68 "Rollback") ---
  await page.getByRole("button", { name: "Undo" }).first().click();

  await expect
    .poll(
      async () => {
        const items = (await (await page.request.get("/api/v1/imports")).json()).data.items;
        return items.find((j: { id: string }) => j.id === jobId)?.status;
      },
      { timeout: 20000 },
    )
    .toBe("ROLLED_BACK");

  const afterUndo = (await (await page.request.get("/api/v1/properties")).json()).data.items;
  expect(afterUndo.length).toBe(before);
  expect(afterUndo.filter((p: { name: string }) => p.name.includes(String(STAMP)))).toHaveLength(0);
});
