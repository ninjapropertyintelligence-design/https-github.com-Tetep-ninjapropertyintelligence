import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { disconnectMatterportForOrg } from "@/lib/matterport-service";

export const POST = withApiHandler(async (ctx) => {
  requirePermission(ctx, "canManageIntegrations");
  const connection = await disconnectMatterportForOrg(ctx);
  return NextResponse.json(connection);
});
