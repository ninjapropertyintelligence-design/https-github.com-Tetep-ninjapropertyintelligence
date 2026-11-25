import { NextResponse } from "next/server";
import { runExpiryReminders } from "@/lib/expiry-service";
import { isCronAuthorized } from "@/lib/cron-auth";

export const maxDuration = 300;

/**
 * GET /api/v1/cron/expiry-reminders — the daily countdown.
 *
 * Counts down every active expiry and tells the people responsible for each
 * store as things near their date, then weekly once one has passed. Safe to
 * run twice in a day: each reminder is claimed before it is sent.
 * Authenticated with CRON_SECRET, like the other scheduled jobs.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ data: null, error: "Unauthorized", meta: {} }, { status: 401 });
  }
  const result = await runExpiryReminders();
  return NextResponse.json({ data: result, error: null, meta: {} });
}
