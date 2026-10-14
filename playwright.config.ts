import { defineConfig } from "@playwright/test";

// Uses the Chromium binary already present in this environment instead of
// downloading one (see PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD in CI/sandbox setup).
// Falls back to Playwright's own managed browser when that path doesn't exist
// (e.g. a contributor's local machine that ran `npx playwright install`).
import { existsSync } from "node:fs";
import { config } from "dotenv";

// Playwright doesn't read .env the way Next does, and specs that touch the
// database directly (tests/e2e/mfa.spec.ts creates its own user) need
// DATABASE_URL. Loaded here, pointing at the same database the dev server
// under test uses — deliberately NOT DATABASE_URL_TEST, which is the
// isolated database the vitest suite owns.
config({ path: ".env" });

const PRE_INSTALLED_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = existsSync(PRE_INSTALLED_CHROMIUM) ? PRE_INSTALLED_CHROMIUM : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false, // shared seeded DB — avoid cross-test interference
  // One worker because the suite shares a single seeded database and several
  // specs mutate it (retention deletes a property, MFA enrols a user). The
  // compile contention this also used to mask is now gone — see webServer
  // below — but the shared-fixture reason stands on its own.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
    launchOptions: { executablePath, args: ["--no-sandbox"] },
  },
  webServer: {
    /**
     * Runs against a production build, not `next dev`. This is a root-cause
     * fix, not a preference.
     *
     * `next dev` compiles each route lazily on first request. Across a 15-spec
     * sequential run that occasionally pushed one route's first compile past a
     * 15s assertion timeout — so exactly one spec failed per full run, a
     * different one each time, and every one of them passed in isolation. That
     * signature was misread as flakiness twice (it is what the `workers: 1`
     * comment below was reaching for, and what left an unexplained
     * retention.spec failure on the §65/§66 pull request).
     *
     * Measured, same machine, same specs:
     *   next dev   ~70s, one spec fails per run
     *   next start  19s, 15/15 pass
     *
     * Building first also means the suite exercises the artefact that actually
     * ships. That matters: `trustHost` was missing from the auth config and
     * only a production build surfaced it, because dev trusts the Host header
     * implicitly. A dev-mode e2e suite could never have caught it.
     */
    command: "npm run build && npm run start",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    // Generous: this budget now covers a full production build, not just boot.
    timeout: 180_000,
  },
});
