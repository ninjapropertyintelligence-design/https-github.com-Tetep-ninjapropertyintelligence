import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { getIntegrationsOverview } from "@/lib/admin-service";

export const GET = withApiHandler(async (ctx) => {
  if (!ctx.isPlatformAdmin) throw new ApiError(403, "Platform admin only");
  const overview = await getIntegrationsOverview();
  return NextResponse.json(overview);
});
