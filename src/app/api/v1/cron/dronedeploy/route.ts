import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { runDueDroneDeployImports } from "@/lib/dronedeploy-import-service";

export const maxDuration = 300;

/**
 * GET /api/v1/cron/dronedeploy — the scheduled import pass.
 *
 * A scheduler has no user session, so this is the one route here that does
 * not go through withApiHandler. It authenticates with a shared secret
 * instead: `Authorization: Bearer $CRON_SECRET`, which is the header Vercel
 * Cron sends (any other scheduler can send the same). With no CRON_SECRET set
 * the route is closed, never open.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ data: null, error: "Unauthorized", meta: {} }, { status: 401 });
  }
  const results = await runDueDroneDeployImports();
  return NextResponse.json({
    data: { organizationsProcessed: results.length, results },
    error: null,
    meta: {},
  });
}
