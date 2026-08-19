import { defineConfig } from "@playwright/test";

// Uses the Chromium binary already present in this environment instead of
// downloading one (see PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD in CI/sandbox setup).
// Falls back to Playwright's own managed browser when that path doesn't exist
// (e.g. a contributor's local machine that ran `npx playwright install`).
import { existsSync } from "node:fs";

const PRE_INSTALLED_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = existsSync(PRE_INSTALLED_CHROMIUM) ? PRE_INSTALLED_CHROMIUM : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false, // shared seeded DB — avoid cross-test interference
  // One worker, not just one test-at-a-time-per-file: the whole suite
  // shares a single dev server and a single seeded database, so parallel
  // workers contend on both and race Turbopack's first compile of each
  // route. That contention (not any assertion) is what pushed the deep
  // property spec past its 30s budget intermittently. Serial is the
  // truthful setting for this suite, and keeps local runs identical to CI.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
    launchOptions: { executablePath, args: ["--no-sandbox"] },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
