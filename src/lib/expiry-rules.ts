/**
 * The rules of expiry tracking, with no database in them: what can expire,
 * how a date is counted down, and when a reminder is due.
 *
 * Kept pure so the rules that decide who gets an email, and when, can be
 * tested without a database or a clock.
 */

/** Common things that run out at a restaurant. A kind is free text; these are offered. */
export const EXPIRY_KINDS = [
  "Fire extinguisher inspection",
  "Hood suppression (Ansul) inspection",
  "Hood and exhaust cleaning",
  "Fire alarm and sprinkler inspection",
  "Backflow preventer test",
  "Grease trap service",
  "Health permit",
  "Food manager certification",
  "Liquor license",
  "Pest control contract",
  "Refrigeration service",
  "Equipment warranty",
] as const;

/** Reminder countdown, in days before expiry. The tightest one passed is the one sent. */
export const REMINDER_THRESHOLDS = [90, 60, 30, 14, 7, 3, 1] as const;

/** Once expired, how often to repeat the notice until someone renews or dismisses it. */
export const OVERDUE_REPEAT_DAYS = 7;

/** The horizon the daily job looks ahead; the largest threshold. */
export const REMINDER_HORIZON_DAYS = REMINDER_THRESHOLDS[0];

const DAY_MS = 86_400_000;

/** Where a store's "today" is decided. These are US restaurants; override with APP_TIMEZONE. */
export function appTimezone(): string {
  return process.env.APP_TIMEZONE || "America/Chicago";
}

/**
 * The calendar date it is right now in the store's timezone, as midnight UTC
 * of that date, which is how a DATE column reads back. Comparing like with
 * like is what keeps "expires today" from flipping at 7 PM local time.
 */
export function calendarDay(at: Date, timeZone: string = appTimezone()): Date {
  // en-CA formats as YYYY-MM-DD.
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Whole days from `today` until `expiresAt`. Negative once it has passed. */
export function daysUntil(expiresAt: Date, today: Date): number {
  const expires = Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth(), expiresAt.getUTCDate());
  const from = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((expires - from) / DAY_MS);
}

export type Urgency = "expired" | "urgent" | "soon" | "ok";

/** How loudly to show a countdown. */
export function urgencyFor(daysLeft: number): Urgency {
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 14) return "urgent";
  if (daysLeft <= 60) return "soon";
  return "ok";
}

/** "Expired 3 days ago", "Expires today", "Expires tomorrow", "12 days left". */
export function countdownLabel(daysLeft: number): string {
  if (daysLeft < -1) return `Expired ${-daysLeft} days ago`;
  if (daysLeft === -1) return "Expired yesterday";
  if (daysLeft === 0) return "Expires today";
  if (daysLeft === 1) return "Expires tomorrow";
  return `${daysLeft} days left`;
}

export type ReminderDecision = { kind: "upcoming"; threshold: number } | { kind: "overdue" } | null;

/**
 * Whether a reminder is due for one item today.
 *
 * Upcoming: the smallest threshold that has been reached (a date 20 days out
 * has reached 30, 60 and 90; it is the 30-day notice). It is sent once, and
 * only if no tighter one has gone. If the job missed several days and two
 * thresholds were crossed, one notice goes, not a burst.
 *
 * Overdue: sent when the date has passed, then again every OVERDUE_REPEAT_DAYS
 * until someone renews or dismisses it.
 */
export function nextReminder(params: {
  daysLeft: number;
  lastReminderDays: number | null;
  lastOverdueNoticeAt: Date | null;
  today: Date;
  timeZone?: string;
}): ReminderDecision {
  const { daysLeft, lastReminderDays, lastOverdueNoticeAt, today } = params;

  if (daysLeft < 0) {
    if (!lastOverdueNoticeAt) return { kind: "overdue" };
    const lastDay = calendarDay(lastOverdueNoticeAt, params.timeZone);
    return Math.round((today.getTime() - lastDay.getTime()) / DAY_MS) >= OVERDUE_REPEAT_DAYS ? { kind: "overdue" } : null;
  }

  const reached = REMINDER_THRESHOLDS.filter((t) => daysLeft <= t);
  if (reached.length === 0) return null;
  const threshold = Math.min(...reached);
  if (lastReminderDays !== null && lastReminderDays <= threshold) return null;
  return { kind: "upcoming", threshold };
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A date as a tag shows it: a year, a month, and sometimes a day. 0 means "not shown". */
export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * Turns the date a model read off a tag into a calendar date, or null when it
 * cannot be trusted.
 *
 * A tag that shows only a month and year ("03/2027") is good through the end
 * of that month, so the day is filled in as the last one: an extinguisher
 * punched for March is not "expired" on March 1st. A year alone is not a date.
 * A year far from now is a misread, not a date.
 */
export function dateFromParts(parts: DateParts, today: Date): { date: Date; precision: "day" | "month" } | null {
  const { year, month, day } = parts;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  const thisYear = today.getUTCFullYear();
  if (year < thisYear - 15 || year > thisYear + 15) return null;
  const last = lastDayOfMonth(year, month);
  if (day < 0 || day > last) return null;
  const precision = day === 0 ? "month" : "day";
  return { date: new Date(Date.UTC(year, month - 1, day === 0 ? last : day)), precision };
}

/** Parses "YYYY-MM-DD" as a calendar date, strictly: "2026-02-30" is not a date. */
export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > lastDayOfMonth(year, month)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/** "2026-12-14", for a DATE value. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type ComplianceStatus = "Current" | "Due soon" | "Expired";

/** The status a record shows to an outsider: expired, due within 60 days, or current. */
export function complianceStatusFor(daysLeft: number): ComplianceStatus {
  if (daysLeft < 0) return "Expired";
  return daysLeft <= 60 ? "Due soon" : "Current";
}

/**
 * How a date came to be on record, in words a reader outside the company can
 * rely on. A date a model read off a photo and nobody has checked is said to
 * be exactly that, never presented as verified.
 */
export function evidenceBasis(params: { source: "MANUAL" | "AI_PHOTO"; needsReview: boolean; hasPhoto: boolean }): string {
  if (params.source === "AI_PHOTO") {
    return params.needsReview
      ? "Read from a photo by software; not yet confirmed by a person"
      : "Read from a photo by software; confirmed by a person";
  }
  return params.hasPhoto ? "Entered by a person; photo of the tag on file" : "Entered by a person";
}
