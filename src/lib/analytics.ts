import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { logEvent } from "@/lib/observability";
import type { SessionContext } from "@/lib/tenant-scope";
import { Role } from "@/generated/prisma/client";

/**
 * PRODUCT ANALYTICS (spec §105).
 *
 * Four rules hold this file together. Each exists because breaking it
 * produces a dashboard that is confidently wrong, which is worse than no
 * dashboard — people make roadmap decisions off these numbers.
 *
 * 1. IMPERSONATED ACTIVITY IS NOT CUSTOMER ACTIVITY. Platform support can
 *    view a customer's account (§45), and while impersonating,
 *    `ctx.organizationId` is the customer's. Counting those clicks would
 *    mean every support investigation registered as engagement — so the
 *    accounts we worry about most would look the healthiest. Excluded
 *    everywhere by default, and countable separately on request.
 *
 * 2. DISTINCT USERS, NOT EVENT COUNTS. One user clicking a feature ten times
 *    is one user who adopted it, not ten.
 *
 * 3. NO DATA IS NOT ZERO. If tracking began last Tuesday, 30-day retention
 *    is unavailable, not 0%. Every summary reports the window it could
 *    actually see and flags when the request reached back further.
 *
 * 4. A CLOSED FEATURE VOCABULARY. Free-text keys turn this table into a
 *    junk drawer where "map", "Map" and "map_view" are three features, and
 *    no adoption figure means anything. Unknown keys are refused.
 */

/**
 * Every feature worth measuring adoption of. Adding a key here is the
 * deliberate act of deciding to measure something.
 */
export const PRODUCT_FEATURES = [
  "dashboard.viewed",
  "portfolio.viewed",
  "property.viewed",
  "map.viewed",
  "asset.viewed",
  "issue.created",
  "issue.resolved",
  "assessment.started",
  "assessment.completed",
  "document.uploaded",
  "document.searched",
  "ai.question_asked",
  "report.generated",
  "report.exported",
  "import.wizard_started",
  "import.wizard_completed",
  "import.wizard_abandoned",
  "drone.capture_created",
  "interior.tour_viewed",
  "cogs.viewed",
  "storage_settings.viewed",
  "retention_settings.viewed",
  "webhook.configured",
  "mfa.enrolled",
] as const;

export type ProductFeature = (typeof PRODUCT_FEATURES)[number];

const FEATURE_SET: ReadonlySet<string> = new Set(PRODUCT_FEATURES);

export function isProductFeature(value: string): value is ProductFeature {
  return FEATURE_SET.has(value);
}

/**
 * Record that someone used a feature.
 *
 * Never throws into the caller's path: analytics is an observation of work
 * that already succeeded, and failing a customer's page load because a
 * metrics row would not insert would be an absurd trade. A dropped row
 * understates adoption, which is logged rather than hidden.
 */
export async function recordProductEvent(
  ctx: SessionContext,
  feature: ProductFeature,
  metadata?: Record<string, string | number | boolean>,
): Promise<void> {
  if (!isProductFeature(feature)) {
    // Unreachable through the type system, but reachable from JS callers and
    // from a stale feature key left behind by a rename.
    logEvent("analytics.record_failed", {
      ok: false,
      organizationId: ctx.organizationId,
      errorMessage: `Unknown product feature "${feature}"`,
    });
    return;
  }

  try {
    await prisma.productEvent.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        feature,
        // The whole point of rule 1. `ctx.impersonation` is set only when
        // platform support is acting inside a customer's account.
        impersonated: ctx.impersonation !== null,
        role: ctx.role,
        metadata: (metadata ?? {}) as never,
      },
    });
  } catch (error) {
    logEvent("analytics.record_failed", {
      ok: false,
      organizationId: ctx.organizationId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface AnalyticsWindow {
  /** What the caller asked for. */
  requestedFrom: Date;
  requestedTo: Date;
  /**
   * The earliest event this organization has. Null when nothing has ever
   * been tracked — which is why an empty dashboard can say "not tracked yet"
   * instead of reporting a confident zero.
   */
  trackingStartedAt: Date | null;
  /**
   * True when the request reached back before tracking began, so figures
   * cover less time than asked. Rule 3.
   */
  partialWindow: boolean;
}

async function resolveWindow(
  organizationId: string,
  from: Date,
  to: Date,
): Promise<AnalyticsWindow> {
  if (to <= from) throw new ApiError(422, "Analytics window must end after it starts");

  const earliest = await prisma.productEvent.findFirst({
    where: { organizationId },
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true },
  });
  const trackingStartedAt = earliest?.occurredAt ?? null;

  return {
    requestedFrom: from,
    requestedTo: to,
    trackingStartedAt,
    partialWindow: trackingStartedAt === null || trackingStartedAt > from,
  };
}

export interface FeatureAdoption {
  feature: ProductFeature;
  /** Distinct users who used it in the window — rule 2. */
  users: number;
  /** Raw event count, reported alongside so heavy use is visible too. */
  events: number;
}

export interface AdoptionSummary {
  window: AnalyticsWindow;
  /** Members who could have used a feature, i.e. the adoption denominator. */
  eligibleUsers: number;
  features: FeatureAdoption[];
  /** Features in the vocabulary that nobody touched, named explicitly. */
  unusedFeatures: ProductFeature[];
  /** Impersonated events excluded from the figures above, for transparency. */
  excludedImpersonatedEvents: number;
}

/**
 * Which features are actually used, by how many distinct people (spec §105).
 *
 * Unused features are listed by name rather than simply absent: "nobody used
 * the import wizard" is the single most actionable output of an adoption
 * report, and it is invisible if the report only lists what was used.
 */
export async function summarizeFeatureAdoption(
  organizationId: string,
  from: Date,
  to: Date,
): Promise<AdoptionSummary> {
  const window = await resolveWindow(organizationId, from, to);

  const rows = await prisma.productEvent.findMany({
    where: {
      organizationId,
      occurredAt: { gte: from, lt: to },
      impersonated: false,
    },
    select: { feature: true, userId: true },
  });

  const excludedImpersonatedEvents = await prisma.productEvent.count({
    where: {
      organizationId,
      occurredAt: { gte: from, lt: to },
      impersonated: true,
    },
  });

  const byFeature = new Map<string, { users: Set<string>; events: number }>();
  for (const row of rows) {
    const entry = byFeature.get(row.feature) ?? { users: new Set<string>(), events: 0 };
    entry.events += 1;
    // A null userId is system activity — it counts as usage but not as a user.
    if (row.userId) entry.users.add(row.userId);
    byFeature.set(row.feature, entry);
  }

  const features: FeatureAdoption[] = [...byFeature.entries()]
    .filter(([feature]) => isProductFeature(feature))
    .map(([feature, v]) => ({
      feature: feature as ProductFeature,
      users: v.users.size,
      events: v.events,
    }))
    .sort((a, b) => b.users - a.users || b.events - a.events);

  const used = new Set(features.map((f) => f.feature));
  const unusedFeatures = PRODUCT_FEATURES.filter((f) => !used.has(f));

  const eligibleUsers = await prisma.membership.count({ where: { organizationId } });

  return { window, eligibleUsers, features, unusedFeatures, excludedImpersonatedEvents };
}

export interface ActiveUsers {
  window: AnalyticsWindow;
  /** Distinct users active in the last day / 7 days / 30 days before `to`. */
  daily: number;
  weekly: number;
  monthly: number;
  /**
   * Null when the tracked history is shorter than the period the ratio
   * describes. A stickiness figure computed from three days of data is
   * noise wearing a percentage sign.
   */
  stickiness: number | null;
}

/**
 * Distinct active users over the standard three periods (spec §105).
 *
 * Counted as distinct users and with impersonated activity excluded — see
 * rules 1 and 2. Stickiness (DAU/MAU) is withheld rather than guessed when
 * there is not yet a month of history.
 */
export async function summarizeActiveUsers(
  organizationId: string,
  to = new Date(),
): Promise<ActiveUsers> {
  const DAY = 24 * 60 * 60 * 1000;
  const monthAgo = new Date(to.getTime() - 30 * DAY);
  const window = await resolveWindow(organizationId, monthAgo, to);

  async function distinct(since: Date): Promise<number> {
    const rows = await prisma.productEvent.findMany({
      where: {
        organizationId,
        impersonated: false,
        userId: { not: null },
        occurredAt: { gte: since, lt: to },
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    return rows.length;
  }

  const [daily, weekly, monthly] = await Promise.all([
    distinct(new Date(to.getTime() - DAY)),
    distinct(new Date(to.getTime() - 7 * DAY)),
    distinct(monthAgo),
  ]);

  const haveFullMonth =
    window.trackingStartedAt !== null && window.trackingStartedAt <= monthAgo;

  return {
    window,
    daily,
    weekly,
    monthly,
    stickiness: haveFullMonth && monthly > 0 ? daily / monthly : null,
  };
}

export interface ActivationStep {
  key: string;
  label: string;
  /** Organizations that have reached this step. */
  organizations: number;
}

export interface ActivationSummary {
  totalOrganizations: number;
  steps: ActivationStep[];
  fullyActivated: number;
}

/**
 * The activation funnel (spec §105), from OnboardingProgress.
 *
 * Organizations with no OnboardingProgress row are counted in the
 * denominator: an organization that never started onboarding is the most
 * important kind of activation failure, and omitting it would make the funnel
 * look better precisely when it is going worst.
 */
const ACTIVATION_STEPS: Array<{ key: keyof ActivationFlags; label: string }> = [
  { key: "organizationSetup", label: "Organization set up" },
  { key: "usersInvited", label: "Users invited" },
  { key: "propertiesImported", label: "Properties imported" },
  { key: "assetsImported", label: "Assets imported" },
  { key: "interiorConnected", label: "Interior capture connected" },
  { key: "exteriorConnected", label: "Exterior capture connected" },
  { key: "firstAssessmentDone", label: "First assessment completed" },
  { key: "aiReady", label: "AI ready" },
];

interface ActivationFlags {
  organizationSetup: boolean;
  usersInvited: boolean;
  propertiesImported: boolean;
  assetsImported: boolean;
  interiorConnected: boolean;
  exteriorConnected: boolean;
  firstAssessmentDone: boolean;
  aiReady: boolean;
}

export async function summarizeActivation(): Promise<ActivationSummary> {
  const [totalOrganizations, rows] = await Promise.all([
    prisma.organization.count(),
    prisma.onboardingProgress.findMany(),
  ]);

  const steps = ACTIVATION_STEPS.map(({ key, label }) => ({
    key,
    label,
    organizations: rows.filter((r) => r[key]).length,
  }));

  const fullyActivated = rows.filter((r) =>
    ACTIVATION_STEPS.every(({ key }) => r[key]),
  ).length;

  return { totalOrganizations, steps, fullyActivated };
}

export interface RetentionCohort {
  /** Start of the week the cohort's members joined (UTC, Monday). */
  cohortWeekStart: Date;
  cohortSize: number;
  /**
   * Users still active in each subsequent week. `null` for weeks that have
   * not fully elapsed yet — a cohort measured mid-week has not "dropped to
   * 20%", it simply has not finished the week.
   */
  weeks: Array<number | null>;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the week containing `date`. */
export function weekStart(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // getUTCDay: 0 = Sunday, so Sunday is 6 days after the preceding Monday.
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * 24 * 60 * 60 * 1000);
}

/**
 * Weekly retention cohorts (spec §105): of the users who joined in week N,
 * how many were still using the product in the weeks after.
 *
 * Weeks that have not finished are reported as null rather than as a low
 * number, because a partial week looks identical to churn and would show a
 * cliff at the right-hand edge of every cohort chart.
 */
export async function summarizeRetention(
  organizationId: string,
  weeks = 8,
  now = new Date(),
): Promise<RetentionCohort[]> {
  if (weeks < 1 || weeks > 52) {
    throw new ApiError(422, "Retention must cover between 1 and 52 weeks");
  }

  const firstWeek = weekStart(new Date(now.getTime() - weeks * WEEK_MS));

  const memberships = await prisma.membership.findMany({
    where: { organizationId, createdAt: { gte: firstWeek } },
    select: { userId: true, createdAt: true },
  });
  if (memberships.length === 0) return [];

  const events = await prisma.productEvent.findMany({
    where: {
      organizationId,
      impersonated: false,
      userId: { not: null },
      occurredAt: { gte: firstWeek },
    },
    select: { userId: true, occurredAt: true },
  });

  /** userId -> set of week-start timestamps in which they were active. */
  const activeWeeks = new Map<string, Set<number>>();
  for (const e of events) {
    if (!e.userId) continue;
    const set = activeWeeks.get(e.userId) ?? new Set<number>();
    set.add(weekStart(e.occurredAt).getTime());
    activeWeeks.set(e.userId, set);
  }

  const cohorts = new Map<number, string[]>();
  for (const m of memberships) {
    const key = weekStart(m.createdAt).getTime();
    const list = cohorts.get(key) ?? [];
    list.push(m.userId);
    cohorts.set(key, list);
  }

  const nowMs = now.getTime();
  return [...cohorts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cohortStart, userIds]) => {
      const weeksOut: Array<number | null> = [];
      for (let w = 0; ; w += 1) {
        const weekBegin = cohortStart + w * WEEK_MS;
        if (weekBegin > nowMs) break;
        const weekEnd = weekBegin + WEEK_MS;
        if (weekEnd > nowMs) {
          // Still in progress — see the doc comment.
          weeksOut.push(null);
          break;
        }
        weeksOut.push(
          userIds.filter((id) => activeWeeks.get(id)?.has(weekBegin)).length,
        );
      }
      return {
        cohortWeekStart: new Date(cohortStart),
        cohortSize: userIds.length,
        weeks: weeksOut,
      };
    });
}

/** Re-exported so callers can label a cohort row without importing Prisma. */
export type { Role };
