import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * The platform team's capture workflow, and the customer's view of its team,
 * through the real UI.
 *
 * Run `npm run db:seed` first.
 */

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });
}

async function chooseFirstCustomer(page: Page) {
  const picker = page.getByLabel("Customer");
  const firstOrg = await picker.locator("option").nth(1).getAttribute("value");
  await picker.selectOption(firstOrg!);
  await page.waitForURL(/\?org=/);
}

test("the platform team gives a vendor a login and sends it a job", async ({ page }) => {
  await signIn(page, "platformadmin@demo.com");

  await expect(page.getByRole("link", { name: "Capture Jobs" })).toBeVisible();
  await page.getByRole("link", { name: "Vendors" }).click();
  await page.waitForURL(/\/admin\/vendors/);
  await chooseFirstCustomer(page);

  // A new vendor company, then a login for one of its people.
  const vendorName = `E2E Capture ${randomUUID().slice(0, 8)}`;
  await page.getByRole("button", { name: "Add vendor company" }).click();
  await page.getByLabel("Company name").fill(vendorName);
  await page.getByRole("button", { name: "Add vendor" }).click();
  await expect(page.getByRole("heading", { name: vendorName })).toBeVisible();

  await page.getByRole("button", { name: `Create a login for ${vendorName}` }).click();
  await page.getByLabel("Email", { exact: true }).fill(`pilot-${randomUUID().slice(0, 8)}@example.com`);
  await page.getByRole("button", { name: "Create login" }).click();
  await expect(page.getByText(/Login created for/)).toBeVisible();
  await expect(page.locator("code", { hasText: "/invite?token=" })).toBeVisible();

  // Order the job on the same customer's sites and send it.
  await page.goto("/admin/capture-jobs/new");
  await chooseFirstCustomer(page);
  const title = `E2E sweep ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Job title").fill(title);
  await page.getByRole("combobox", { name: /^Vendor/ }).selectOption({ label: vendorName });
  await page.getByPlaceholder("Filter by name, city or region").fill("1052");
  await page.getByRole("button", { name: "Select shown" }).click();

  // A site the customer does not have yet, added from the job and ticked for it.
  const siteName = `E2E Store ${randomUUID().slice(0, 6)}`;
  await page.getByRole("button", { name: "+ Add a new site" }).click();
  await page.getByLabel("Site name").fill(siteName);
  await page.getByLabel("Street address").fill("1 Test Way");
  await page.getByLabel("City", { exact: true }).fill("Springfield");
  await page.getByLabel("State", { exact: true }).fill("MO");
  await page.getByLabel("ZIP code").fill("65801");
  await page.getByRole("button", { name: "Add site", exact: true }).click();
  await expect(page.getByText(`${siteName} added to the customer`)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Sites \(2 of/)).toBeVisible();

  // What the vendor must capture at each site.
  await page.getByRole("button", { name: "+ Add requirement" }).click();
  await page.getByLabel("Requirement 1", { exact: true }).fill("Roof — RTU row");
  await page.getByLabel("Notes for requirement 1").fill("Include the data plate");

  await page.getByRole("button", { name: "Send to vendor" }).click();

  await page.waitForURL(/\/capture-jobs\/[^/?]+$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(siteName)).toBeVisible();
  await expect(page.getByText("Include the data plate").first()).toBeVisible();
  await expect(page.getByText(/issued/).first()).toBeVisible();

  await page.goto("/admin/capture-jobs");
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
});

test("a customer can no longer reach the platform's capture screens", async ({ page }) => {
  await signIn(page, "owner@demo.com");
  await page.goto("/admin/capture-jobs");
  await page.waitForURL(/\/dashboard/);
});

test("the owner sees the team, what each person can see, and their activity", async ({ page }) => {
  await signIn(page, "owner@demo.com");
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await page.waitForURL(/\/settings\/team/);

  const row = page.getByRole("row", { name: /Marcus Reid/ });
  await expect(row).toContainText("Regional Manager");
  await expect(row).toContainText("Region: Midwest");

  await row.getByRole("link", { name: /action/ }).click();
  await page.waitForURL(/\/settings\/activity\?user=/);
  await expect(page.getByRole("heading", { name: "Marcus Reid's activity" })).toBeVisible();
});

test("a portfolio admin sees team activity, a regional manager does not", async ({ page }) => {
  await signIn(page, "portfolioadmin@demo.com");
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page.waitForURL(/\/settings\/activity/);
  // Their own sign-in a moment ago is the newest thing on it.
  await expect(page.getByText("Signed in").first()).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, "regionalmanager@demo.com");
  await expect(page.getByRole("link", { name: "Activity", exact: true })).toHaveCount(0);
  await page.goto("/settings/activity");
  await page.waitForURL(/\/dashboard/);
});

test("a vendor can reach every way of delivering: connections, flights, scans and condition scores", async ({ page }) => {
  await signIn(page, "vendor@demo.com");
  await page.getByRole("link", { name: "Connections" }).click();
  await page.waitForURL(/\/settings\/connections/);
  await expect(page.getByRole("button", { name: "Connect DroneDeploy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Matterport" })).toBeVisible();

  // The seeded job asks for drone, Matterport and condition scores.
  await page.goto("/capture-jobs");
  await page.getByRole("link", { name: /Q4 condition sweep/ }).click();
  await page.waitForURL(/\/capture-jobs\/[^/?]+$/);
  await expect(page.getByText("DroneDeploy is not connected.")).toBeVisible();
  await expect(page.getByText("Matterport is not connected.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter condition scores" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add an asset" })).toBeVisible();
});

/**
 * A small uncompressed RGB TIFF — the same container as DroneDeploy's GeoTIFF
 * map export — built here so the spec needs no binary fixture.
 */
function rgbTiff(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = 40;
    pixels[i * 3 + 1] = (i % width) * 4;
    pixels[i * 3 + 2] = 90;
  }
  const entries: Array<[number, number, number, number]> = []; // tag, type, count, value
  const bitsOffset = 8;
  const dataOffset = bitsOffset + 6;
  const ifdOffset = dataOffset + pixels.length;
  entries.push([256, 3, 1, width], [257, 3, 1, height], [258, 3, 3, bitsOffset], [259, 3, 1, 1], [262, 3, 1, 2]);
  entries.push([273, 4, 1, dataOffset], [277, 3, 1, 3], [278, 3, 1, height], [279, 4, 1, pixels.length], [284, 3, 1, 1]);
  const header = Buffer.alloc(8);
  header.write("II", 0, "ascii");
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(ifdOffset, 4);
  const bits = Buffer.alloc(6);
  [8, 8, 8].forEach((b, i) => bits.writeUInt16LE(b, i * 2));
  const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
  ifd.writeUInt16LE(entries.length, 0);
  entries.forEach(([tag, type, count, value], i) => {
    const at = 2 + i * 12;
    ifd.writeUInt16LE(tag, at);
    ifd.writeUInt16LE(type, at + 2);
    ifd.writeUInt32LE(count, at + 4);
    if (type === 3 && count === 1) ifd.writeUInt16LE(value, at + 8);
    else ifd.writeUInt32LE(value, at + 8);
  });
  return Buffer.concat([header, bits, pixels, ifd]);
}

test("a vendor uploads a finished DroneDeploy map, and the platform team sees it to approve", async ({ page }) => {
  await signIn(page, "vendor@demo.com");
  await page.goto("/capture-jobs");
  await page.getByRole("link", { name: /Q4 condition sweep/ }).click();
  await page.waitForURL(/\/capture-jobs\/[^/?]+$/);
  const jobUrl = page.url();

  await page.locator("select[id^='kind-']").first().selectOption("DRONE_MAP");
  await page.getByLabel("Finished drone files").setInputFiles([
    { name: "Store 1052 Orthomosaic.tif", mimeType: "image/tiff", buffer: rgbTiff(64, 32) },
  ]);
  await expect(page.getByLabel("What Store 1052 Orthomosaic.tif is")).toHaveValue("ORTHOMOSAIC");
  await page.getByRole("button", { name: /Upload 1 file/ }).click();
  await expect(page.getByText("uploaded, with a viewable preview")).toBeVisible({ timeout: 20000 });

  await page.context().clearCookies();
  await signIn(page, "platformadmin@demo.com");
  await page.goto(jobUrl);
  await expect(page.getByText("Drone work delivered")).toBeVisible();
  await expect(page.getByRole("img", { name: "Drone map" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Store_1052_Orthomosaic\.tif/ }).first()).toBeVisible();
});
