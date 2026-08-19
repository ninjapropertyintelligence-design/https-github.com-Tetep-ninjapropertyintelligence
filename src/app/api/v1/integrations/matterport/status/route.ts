import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { getOrgMatterportStatus } from "@/lib/matterport-service";

export const GET = withApiHandler(async (ctx) => {
  const status = await getOrgMatterportStatus(ctx.organizationId);
  return NextResponse.json(status);
});
