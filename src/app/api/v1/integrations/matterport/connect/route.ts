import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { connectMatterportForOrg } from "@/lib/matterport-service";

// POST /api/v1/integrations/matterport/connect — org-level connect/retry
// (spec §2). Reads credentials from env (MATTERPORT_API_TOKEN/SECRET/SDK_KEY)
// rather than the request body — we never let a client hand us API secrets
// to store on another org's behalf.
export const POST = withApiHandler(async (ctx) => {
  requirePermission(ctx, "canManageIntegrations");
  const connection = await connectMatterportForOrg(ctx);
  return NextResponse.json(connection);
});
