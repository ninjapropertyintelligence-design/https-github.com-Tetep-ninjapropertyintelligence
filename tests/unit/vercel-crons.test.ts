import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Vercel team is on the Hobby plan, which allows each cron to run at most
 * once a day, and FAILS THE DEPLOYMENT otherwise — every deploy, not just the
 * cron. A schedule edited to "every 5 minutes" would look harmless in review
 * and take the whole app's deploys down, so it is caught here instead.
 *
 * Moving to Pro? Delete this test and tighten the schedules.
 */
const config = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
  crons?: Array<{ path: string; schedule: string }>;
};

describe("vercel.json crons", () => {
  it("runs each cron at most once a day (Hobby plan limit)", () => {
    for (const cron of config.crons ?? []) {
      const [minute, hour] = cron.schedule.trim().split(/\s+/);
      expect(minute, `${cron.path}: minute must be one fixed value`).toMatch(/^\d+$/);
      expect(hour, `${cron.path}: hour must be one fixed value`).toMatch(/^\d+$/);
    }
  });

  it("points every cron at a route that exists and is authenticated", () => {
    for (const cron of config.crons ?? []) {
      const file = path.join(process.cwd(), "src/app", cron.path, "route.ts");
      const source = readFileSync(file, "utf8");
      expect(source, `${cron.path} must check CRON_SECRET`).toContain("isCronAuthorized");
    }
  });
});
