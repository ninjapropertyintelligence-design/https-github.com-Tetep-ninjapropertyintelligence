import { NextResponse } from "next/server";
import { runDueDroneDeployImports } from "@/lib/dronedeploy-import-service";
import { isCronAuthorized } from "@/lib/cron-auth";

export const maxDuration = 300;

/**
 * GET /api/v1/cron/dronedeploy — the scheduled import pass.
 *
 * Authenticated with CRON_SECRET rather than a session; see `isCronAuthorized`.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ data: null, error: "Unauthorized", meta: {} }, { status: 401 });
  }
  const results = await runDueDroneDeployImports();
  return NextResponse.json({
    data: { organizationsProcessed: results.length, results },
    error: null,
    meta: {},
  });
}
