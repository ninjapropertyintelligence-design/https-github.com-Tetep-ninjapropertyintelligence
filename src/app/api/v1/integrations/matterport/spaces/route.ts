import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { listAvailableSpaces } from "@/lib/matterport-service";

export const GET = withApiHandler(async (ctx) => {
  requirePermission(ctx, "canPerformCapture");
  const spaces = await listAvailableSpaces(ctx);
  return NextResponse.json({ items: spaces });
});
