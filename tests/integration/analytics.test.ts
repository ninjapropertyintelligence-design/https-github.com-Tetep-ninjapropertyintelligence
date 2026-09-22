import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { Role } from "@/generated/prisma/client";
import {
  PRODUCT_FEATURES,
  isProductFeature,
  recordProductEvent,
  summarizeActiveUsers,
  summarizeActivation,
  summarizeFeatureAdoption,
  summarizeRetention,
  weekStart,
} from "@/lib/analytics";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Product analytics (§105) against real Postgres.
 *
 * The cases that matter are the ones where a dashboard would read as
 * authoritative and mislead a roadmap decision: support impersonation
 * counted as customer engagement, repeat clicks counted as users, an
 * untracked period reported as zero, and a partial week reported as churn.
 */

const suffix = `an${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let userA: { id: string };
let userB: { id: string };
let admin: { id: string };

function ctxFor(
  orgId: string,
  userId: string,
  impersonation: SessionContext["impersonation"] = null,
): SessionContext {
  return {
    userId,
    userName: "AN User",
    userEmail: `${userId}@example.com`,
    isPlatformAdmin: false,
    organizationId: orgId,
    organizationName: "AN Org",
    membershipId: "irrelevant",
    role: Role.OWNER,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation,
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-03-16T12:00:00Z"); // a Monday
const FROM = new Date(NOW.getTime() - 30 * DAY);

/** Writes an event directly so `occurredAt` can be controlled. */
async function seedEvent(params: {
  orgId: string;
  userId: string | null;
  feature: string;
  occurredAt: Date;
  impersonated?: boolean;
}) {
  return prisma.productEvent.create({
    data: {
      organizationId: params.orgId,
      userId: params.userId,
      feature: params.feature,
      impersonated: params.impersonated ?? false,
      role: Role.OWNER,
      occurredAt: params.occurredAt,
    },
  });
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `AN Org ${suffix}`, slug: `an-org-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `AN Other ${suffix}`, slug: `an-other-${suffix}` } });
  userA = await prisma.user.create({ data: { email: `a-${suffix}@example.com`, passwordHash: "x", name: "A" } });
  userB = await prisma.user.create({ data: { email: `b-${suffix}@example.com`, passwordHash: "x", name: "B" } });
  admin = await prisma.user.create({ data: { email: `adm-${suffix}@example.com`, passwordHash: "x", name: "Adm", isPlatformAdmin: true } });
});

beforeEach(async () => {
  await prisma.productEvent.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
  await prisma.membership.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
});

afterAll(async () => {
  await prisma.productEvent.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id, admin.id] } } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.organization.delete({ where: { id: otherOrg.id } });
});

describe("the feature vocabulary", () => {
  it("accepts a known key and refuses anything else", () => {
    expect(isProductFeature("map.viewed")).toBe(true);
    // Free-text keys would make "map", "Map" and "map_view" three features
    // and every adoption figure meaningless.
    expect(isProductFeature("Map")).toBe(false);
    expect(isProductFeature("map_view")).toBe(false);
    expect(isProductFeature("")).toBe(false);
  });

  it("has no duplicate keys, which would double-count a feature", () => {
    expect(new Set(PRODUCT_FEATURES).size).toBe(PRODUCT_FEATURES.length);
  });
});

describe("recordProductEvent", () => {
  it("records an event for a real user session", async () => {
    await recordProductEvent(ctxFor(org.id, userA.id), "map.viewed");
    const rows = await prisma.productEvent.findMany({ where: { organizationId: org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].feature).toBe("map.viewed");
    expect(rows[0].impersonated).toBe(false);
  });

  it("marks an impersonated session as impersonated", async () => {
    // Rule 1. Platform support viewing a customer's account carries the
    // CUSTOMER's organizationId, so without this flag their clicks are
    // indistinguishable from the customer's own.
    await recordProductEvent(
      ctxFor(org.id, userA.id, {
        sessionId: "s1",
        adminUserId: admin.id,
        adminName: "Adm",
      } as SessionContext["impersonation"]),
      "map.viewed",
    );
    const row = await prisma.productEvent.findFirst({ where: { organizationId: org.id } });
    expect(row?.impersonated).toBe(true);
  });

  it("refuses a key outside the vocabulary without throwing", async () => {
    await recordProductEvent(ctxFor(org.id, userA.id), "not.a.feature" as never);
    expect(await prisma.productEvent.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("does not throw when the row cannot be written", async () => {
    // Analytics observes work that already succeeded. Failing the caller's
    // page load over a metrics row would be an absurd trade.
    await expect(
      recordProductEvent(ctxFor("does-not-exist", userA.id), "map.viewed"),
    ).resolves.toBeUndefined();
  });
});

describe("summarizeFeatureAdoption", () => {
  it("counts distinct users, not repeat clicks", async () => {
    // Rule 2. One user clicking ten times is one adopter.
    for (let i = 0; i < 10; i += 1) {
      await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: NOW });
    }
    const summary = await summarizeFeatureAdoption(org.id, FROM, new Date(NOW.getTime() + DAY));
    const map = summary.features.find((f) => f.feature === "map.viewed");
    expect(map?.users).toBe(1);
    expect(map?.events).toBe(10);
  });

  it("EXCLUDES impersonated activity from adoption", async () => {
    // The failure this prevents: every account under support investigation
    // would look like the most engaged account we have.
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "cogs.viewed", occurredAt: NOW, impersonated: true });
    const summary = await summarizeFeatureAdoption(org.id, FROM, new Date(NOW.getTime() + DAY));
    expect(summary.features.find((f) => f.feature === "cogs.viewed")).toBeUndefined();
    // ...but reports that it excluded something, rather than hiding it.
    expect(summary.excludedImpersonatedEvents).toBe(1);
    expect(summary.unusedFeatures).toContain("cogs.viewed");
  });

  it("names the features nobody used", async () => {
    // The most actionable line in an adoption report is invisible if the
    // report only lists what was used.
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: NOW });
    const summary = await summarizeFeatureAdoption(org.id, FROM, new Date(NOW.getTime() + DAY));
    expect(summary.unusedFeatures).toContain("import.wizard_started");
    expect(summary.unusedFeatures).not.toContain("map.viewed");
    expect(summary.features.length + summary.unusedFeatures.length).toBe(PRODUCT_FEATURES.length);
  });

  it("counts system activity as usage but not as a user", async () => {
    await seedEvent({ orgId: org.id, userId: null, feature: "report.generated", occurredAt: NOW });
    const summary = await summarizeFeatureAdoption(org.id, FROM, new Date(NOW.getTime() + DAY));
    const line = summary.features.find((f) => f.feature === "report.generated");
    expect(line?.events).toBe(1);
    expect(line?.users).toBe(0);
  });

  it("reports the eligible-user denominator", async () => {
    await prisma.membership.create({ data: { userId: userA.id, organizationId: org.id, role: Role.OWNER } });
    await prisma.membership.create({ data: { userId: userB.id, organizationId: org.id, role: Role.OWNER } });
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: NOW });
    const summary = await summarizeFeatureAdoption(org.id, FROM, new Date(NOW.getTime() + DAY));
    // 1 of 2 members used the map — a ratio is meaningless without this.
    expect(summary.eligibleUsers).toBe(2);
  });

  it("flags a window that reaches back before tracking began", async () => {
    // Rule 3. Ten days of data does not answer a thirty-day question.
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: new Date(NOW.getTime() - 10 * DAY) });
    const summary = await summarizeFeatureAdoption(org.id, FROM, new Date(NOW.getTime() + DAY));
    expect(summary.window.partialWindow).toBe(true);
    expect(summary.window.trackingStartedAt).not.toBeNull();
  });

  it("says nothing was tracked rather than reporting a confident zero", async () => {
    const summary = await summarizeFeatureAdoption(org.id, FROM, NOW);
    expect(summary.window.trackingStartedAt).toBeNull();
    expect(summary.window.partialWindow).toBe(true);
    expect(summary.features).toHaveLength(0);
  });

  it("excludes another organization's events", async () => {
    await seedEvent({ orgId: otherOrg.id, userId: userB.id, feature: "map.viewed", occurredAt: NOW });
    const summary = await summarizeFeatureAdoption(org.id, FROM, new Date(NOW.getTime() + DAY));
    expect(summary.features).toHaveLength(0);
  });

  it("excludes events outside the window", async () => {
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: new Date(NOW.getTime() - 90 * DAY) });
    const summary = await summarizeFeatureAdoption(org.id, FROM, new Date(NOW.getTime() + DAY));
    expect(summary.features).toHaveLength(0);
  });

  it("refuses an inverted window", async () => {
    await expect(summarizeFeatureAdoption(org.id, NOW, FROM)).rejects.toThrow(ApiError);
  });
});

describe("summarizeActiveUsers", () => {
  it("counts each user once per period", async () => {
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) });
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "portfolio.viewed", occurredAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) });
    await seedEvent({ orgId: org.id, userId: userB.id, feature: "map.viewed", occurredAt: new Date(NOW.getTime() - 3 * DAY) });

    const active = await summarizeActiveUsers(org.id, NOW);
    expect(active.daily).toBe(1);   // only userA today
    expect(active.weekly).toBe(2);  // both within 7 days
    expect(active.monthly).toBe(2);
  });

  it("excludes impersonated activity from active users", async () => {
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: NOW, impersonated: true });
    const active = await summarizeActiveUsers(org.id, new Date(NOW.getTime() + 60_000));
    expect(active.daily).toBe(0);
  });

  it("withholds stickiness when there is not yet a month of history", async () => {
    // A DAU/MAU ratio from three days of data is noise wearing a percentage.
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: new Date(NOW.getTime() - 3 * DAY) });
    const active = await summarizeActiveUsers(org.id, NOW);
    expect(active.stickiness).toBeNull();
  });

  it("reports stickiness once a full month is tracked", async () => {
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: new Date(NOW.getTime() - 40 * DAY) });
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: new Date(NOW.getTime() - 60 * 60 * 1000) });
    await seedEvent({ orgId: org.id, userId: userB.id, feature: "map.viewed", occurredAt: new Date(NOW.getTime() - 10 * DAY) });

    const active = await summarizeActiveUsers(org.id, NOW);
    expect(active.monthly).toBe(2);
    expect(active.daily).toBe(1);
    expect(active.stickiness).toBeCloseTo(0.5, 6);
  });
});

describe("summarizeActivation", () => {
  it("counts an organization that never started onboarding in the denominator", async () => {
    // An organization that never began is the most important activation
    // failure; omitting it flatters the funnel exactly when things go worst.
    const summary = await summarizeActivation();
    expect(summary.totalOrganizations).toBeGreaterThanOrEqual(2);
    const setup = summary.steps.find((s) => s.key === "organizationSetup");
    expect(setup?.organizations).toBeLessThanOrEqual(summary.totalOrganizations);
  });

  it("reports every step in the funnel, in order", async () => {
    const summary = await summarizeActivation();
    expect(summary.steps.map((s) => s.key)).toEqual([
      "organizationSetup",
      "usersInvited",
      "propertiesImported",
      "assetsImported",
      "interiorConnected",
      "exteriorConnected",
      "firstAssessmentDone",
      "aiReady",
    ]);
  });

  it("counts an organization as fully activated only when every step is done", async () => {
    await prisma.onboardingProgress.create({
      data: { organizationId: org.id, organizationSetup: true, usersInvited: true, propertiesImported: true },
    });
    const partial = await summarizeActivation();
    const before = partial.fullyActivated;

    await prisma.onboardingProgress.update({
      where: { organizationId: org.id },
      data: {
        assetsImported: true, interiorConnected: true, exteriorConnected: true,
        firstAssessmentDone: true, aiReady: true,
      },
    });
    const after = await summarizeActivation();
    expect(after.fullyActivated).toBe(before + 1);

    await prisma.onboardingProgress.delete({ where: { organizationId: org.id } });
  });
});

describe("weekStart", () => {
  it("snaps to Monday 00:00 UTC", () => {
    // Sunday must belong to the week that began the preceding Monday, not
    // the one starting the next day.
    expect(weekStart(new Date("2026-03-22T23:59:59Z")).toISOString()).toBe("2026-03-16T00:00:00.000Z");
    expect(weekStart(new Date("2026-03-16T00:00:00Z")).toISOString()).toBe("2026-03-16T00:00:00.000Z");
    expect(weekStart(new Date("2026-03-18T13:00:00Z")).toISOString()).toBe("2026-03-16T00:00:00.000Z");
  });
});

describe("summarizeRetention", () => {
  it("reports a cohort and who came back", async () => {
    const joined = new Date("2026-02-16T10:00:00Z"); // Monday
    await prisma.membership.create({
      data: { userId: userA.id, organizationId: org.id, role: Role.OWNER, createdAt: joined },
    });
    await prisma.membership.create({
      data: { userId: userB.id, organizationId: org.id, role: Role.OWNER, createdAt: joined },
    });
    // Both active in week 0; only userA returns in week 1.
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: new Date("2026-02-17T10:00:00Z") });
    await seedEvent({ orgId: org.id, userId: userB.id, feature: "map.viewed", occurredAt: new Date("2026-02-18T10:00:00Z") });
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: new Date("2026-02-24T10:00:00Z") });

    const cohorts = await summarizeRetention(org.id, 8, NOW);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].cohortSize).toBe(2);
    expect(cohorts[0].weeks[0]).toBe(2);
    expect(cohorts[0].weeks[1]).toBe(1);
  });

  it("reports an unfinished week as null, not as churn", async () => {
    // A partial week looks identical to a cliff, and would put a false drop
    // at the right-hand edge of every cohort chart.
    const thisMonday = weekStart(NOW);
    await prisma.membership.create({
      data: { userId: userA.id, organizationId: org.id, role: Role.OWNER, createdAt: thisMonday },
    });
    await seedEvent({ orgId: org.id, userId: userA.id, feature: "map.viewed", occurredAt: NOW });

    const cohorts = await summarizeRetention(org.id, 8, NOW);
    expect(cohorts[0].weeks[cohorts[0].weeks.length - 1]).toBeNull();
  });

  it("ignores impersonated activity when deciding who was retained", async () => {
    const joined = new Date("2026-02-16T10:00:00Z");
    await prisma.membership.create({
      data: { userId: userA.id, organizationId: org.id, role: Role.OWNER, createdAt: joined },
    });
    // The only "activity" is support looking at the account. That is not the
    // customer coming back.
    await seedEvent({
      orgId: org.id, userId: userA.id, feature: "map.viewed",
      occurredAt: new Date("2026-02-17T10:00:00Z"), impersonated: true,
    });
    const cohorts = await summarizeRetention(org.id, 8, NOW);
    expect(cohorts[0].weeks[0]).toBe(0);
  });

  it("returns nothing when the organization has no members in range", async () => {
    expect(await summarizeRetention(org.id, 8, NOW)).toEqual([]);
  });

  it("refuses an out-of-range week count", async () => {
    await expect(summarizeRetention(org.id, 0, NOW)).rejects.toThrow(ApiError);
    await expect(summarizeRetention(org.id, 53, NOW)).rejects.toThrow(ApiError);
  });
});

/**
 * The service is only worth anything if real usage reaches it. These assert
 * the wiring: without it every test above still passes while the table stays
 * empty forever, because nothing would ever have recorded a row.
 */
describe("page-view wiring", () => {
  it("has tracking calls on the pages whose view is the signal", async () => {
    const { readFile } = await import("node:fs/promises");
    const expected: Array<[string, string]> = [
      ["src/app/(app)/dashboard/page.tsx", "dashboard.viewed"],
      ["src/app/(app)/map/page.tsx", "map.viewed"],
      ["src/app/(app)/properties/page.tsx", "portfolio.viewed"],
      ["src/app/(app)/properties/[id]/page.tsx", "property.viewed"],
      ["src/app/(app)/assets/[id]/page.tsx", "asset.viewed"],
      ["src/app/(app)/reports/cogs/page.tsx", "cogs.viewed"],
      ["src/app/(app)/settings/usage/page.tsx", null as unknown as string],
    ];
    for (const [path, feature] of expected) {
      if (feature === null) continue;
      const source = await readFile(path, "utf8");
      expect(source, `${path} should record ${feature}`).toContain(
        `recordProductEvent(ctx, "${feature}"`,
      );
    }
  });

  it("records a detail-page view only AFTER the scope check", async () => {
    // Recording before authorization would count blocked requests as views,
    // inflating adoption with access failures.
    const { readFile } = await import("node:fs/promises");
    for (const path of [
      "src/app/(app)/properties/[id]/page.tsx",
      "src/app/(app)/assets/[id]/page.tsx",
    ]) {
      const source = await readFile(path, "utf8");
      const guard = source.indexOf("notFound()");
      const track = source.indexOf("recordProductEvent(ctx,");
      expect(guard, `${path} should have a notFound guard`).toBeGreaterThan(-1);
      expect(track, `${path} should track after the guard`).toBeGreaterThan(guard);
    }
  });

  it("records the dashboard view only after the platform-admin redirect", async () => {
    // A platform admin with no organization has no organizationId to
    // attribute a view to.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/app/(app)/dashboard/page.tsx", "utf8");
    const redirectAt = source.indexOf('redirect("/admin")');
    const track = source.indexOf("recordProductEvent(ctx,");
    expect(redirectAt).toBeGreaterThan(-1);
    expect(track).toBeGreaterThan(redirectAt);
  });

  it("only ever records keys that exist in the vocabulary", async () => {
    // A renamed feature key that nothing updated would write rows no
    // dashboard can ever attribute.
    const { readFile, readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");

    // A manual walk rather than fs.glob: glob exists at runtime but is not
    // in this @types/node, and a test that fails typecheck is not a test.
    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const out: string[] = [];
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) out.push(...(await walk(full)));
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
      }
      return out;
    }
    const files = (await walk("src")).filter((f) => !f.includes("generated"));

    const used = new Set<string>();
    for (const f of files) {
      const source = await readFile(f, "utf8");
      for (const m of source.matchAll(/recordProductEvent\(\s*ctx\s*,\s*"([^"]+)"/g)) {
        used.add(m[1]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const key of used) {
      expect(isProductFeature(key), `"${key}" is not in PRODUCT_FEATURES`).toBe(true);
    }
  });
});
