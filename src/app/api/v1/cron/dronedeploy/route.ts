import { NextResponse } from "next/server";
import { runDueDroneDeployImports, runVendorDroneDeployImports } from "@/lib/dronedeploy-import-service";
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
  // Maps vendors picked from their own accounts, on their own keys.
  const vendor = await runVendorDroneDeployImports();
  return NextResponse.json({
    data: { organizationsProcessed: results.length, results, vendor },
    error: null,
    meta: {},
  });
}
