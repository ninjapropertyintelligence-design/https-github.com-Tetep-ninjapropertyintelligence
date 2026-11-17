import { describe, expect, it } from "vitest";
import {
  calendarDay,
  countdownLabel,
  dateFromParts,
  daysUntil,
  nextReminder,
  parseCalendarDate,
  urgencyFor,
} from "@/lib/expiry-rules";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("calendarDay", () => {
  it("uses the store's date, not UTC's, late in the evening", () => {
    // 9 PM in Chicago on Dec 1 is already Dec 2 in UTC.
    expect(calendarDay(new Date("2026-12-02T03:00:00Z"), "America/Chicago")).toEqual(day("2026-12-01"));
    expect(calendarDay(new Date("2026-12-02T13:00:00Z"), "America/Chicago")).toEqual(day("2026-12-02"));
  });
});

describe("daysUntil and labels", () => {
  it("counts whole days, negative once past", () => {
    expect(daysUntil(day("2026-12-14"), day("2026-12-01"))).toBe(13);
    expect(daysUntil(day("2026-12-01"), day("2026-12-01"))).toBe(0);
    expect(daysUntil(day("2026-11-28"), day("2026-12-01"))).toBe(-3);
  });
  it("counts across a daylight-saving change as whole days", () => {
    expect(daysUntil(day("2027-03-15"), day("2027-03-01"))).toBe(14);
  });
  it("words the countdown", () => {
    expect(countdownLabel(12)).toBe("12 days left");
    expect(countdownLabel(1)).toBe("Expires tomorrow");
    expect(countdownLabel(0)).toBe("Expires today");
    expect(countdownLabel(-1)).toBe("Expired yesterday");
    expect(countdownLabel(-9)).toBe("Expired 9 days ago");
  });
  it("grades urgency", () => {
    expect([-1, 0, 14, 15, 60, 61].map(urgencyFor)).toEqual(["expired", "urgent", "urgent", "soon", "soon", "ok"]);
  });
});

describe("nextReminder", () => {
  const today = day("2026-12-01");
  const base = { lastReminderDays: null, lastOverdueNoticeAt: null, today };

  it("is quiet while more than 90 days out", () => {
    expect(nextReminder({ ...base, daysLeft: 91 })).toBeNull();
  });
  it("sends the smallest threshold reached, once", () => {
    expect(nextReminder({ ...base, daysLeft: 90 })).toEqual({ kind: "upcoming", threshold: 90 });
    expect(nextReminder({ ...base, daysLeft: 20 })).toEqual({ kind: "upcoming", threshold: 30 });
    expect(nextReminder({ ...base, daysLeft: 20, lastReminderDays: 30 })).toBeNull();
    expect(nextReminder({ ...base, daysLeft: 20, lastReminderDays: 60 })).toEqual({ kind: "upcoming", threshold: 30 });
  });
  it("sends one notice, not a burst, when the job missed several thresholds", () => {
    // Last notice was the 90-day one; the job then missed a month and it is now 5 days out.
    expect(nextReminder({ ...base, daysLeft: 5, lastReminderDays: 90 })).toEqual({ kind: "upcoming", threshold: 7 });
  });
  it("counts down to the day itself", () => {
    expect(nextReminder({ ...base, daysLeft: 0 })).toEqual({ kind: "upcoming", threshold: 1 });
    expect(nextReminder({ ...base, daysLeft: 0, lastReminderDays: 1 })).toBeNull();
  });
  it("sends an overdue notice at once, then weekly", () => {
    expect(nextReminder({ ...base, daysLeft: -1 })).toEqual({ kind: "overdue" });
    const sent = new Date("2026-11-30T14:00:00Z");
    expect(nextReminder({ ...base, daysLeft: -2, lastOverdueNoticeAt: sent })).toBeNull();
    // Six days on: not yet. Seven days on: due again.
    expect(nextReminder({ ...base, daysLeft: -6, today: day("2026-12-06"), lastOverdueNoticeAt: sent })).toBeNull();
    expect(nextReminder({ ...base, daysLeft: -7, today: day("2026-12-07"), lastOverdueNoticeAt: sent })).toEqual({ kind: "overdue" });
  });
});

describe("dateFromParts (what a model read off a tag)", () => {
  const today = day("2026-12-01");
  it("keeps a full date", () => {
    expect(dateFromParts({ year: 2027, month: 3, day: 15 }, today)).toEqual({ date: day("2027-03-15"), precision: "day" });
  });
  it("treats month and year as good through the end of the month", () => {
    expect(dateFromParts({ year: 2027, month: 2, day: 0 }, today)).toEqual({ date: day("2027-02-28"), precision: "month" });
    expect(dateFromParts({ year: 2028, month: 2, day: 0 }, today)?.date).toEqual(day("2028-02-29"));
  });
  it("refuses what is not a date or is far from now", () => {
    expect(dateFromParts({ year: 2027, month: 0, day: 0 }, today)).toBeNull(); // year alone
    expect(dateFromParts({ year: 2027, month: 13, day: 1 }, today)).toBeNull();
    expect(dateFromParts({ year: 2027, month: 2, day: 30 }, today)).toBeNull();
    expect(dateFromParts({ year: 1999, month: 5, day: 5 }, today)).toBeNull();
    expect(dateFromParts({ year: 2090, month: 5, day: 5 }, today)).toBeNull();
    expect(dateFromParts({ year: 2027.5, month: 5, day: 5 }, today)).toBeNull();
  });
});

describe("parseCalendarDate", () => {
  it("is strict", () => {
    expect(parseCalendarDate("2026-12-14")).toEqual(day("2026-12-14"));
    expect(parseCalendarDate("2026-02-30")).toBeNull();
    expect(parseCalendarDate("12/14/2026")).toBeNull();
    expect(parseCalendarDate("")).toBeNull();
  });
});
