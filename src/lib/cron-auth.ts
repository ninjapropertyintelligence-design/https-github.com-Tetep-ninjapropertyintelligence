import crypto from "node:crypto";

/**
 * Authenticates a scheduled call: `Authorization: Bearer $CRON_SECRET`,
 * which is the header Vercel Cron sends (any other scheduler can send the
 * same). A scheduler has no user session, so cron routes are the one place
 * that does not go through withApiHandler.
 *
 * With no CRON_SECRET set the routes are closed, never open. Compared in
 * constant time so the secret cannot be guessed a character at a time.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
