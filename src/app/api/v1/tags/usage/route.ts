import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { tagUsage } from "@/lib/tag-service";

// GET ?tagTypeId= | ?tagValueId= — how many photos and responses carry it, asked before deleting.
export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const tagTypeId = url.searchParams.get("tagTypeId");
  const tagValueId = url.searchParams.get("tagValueId");
  if (!tagTypeId && !tagValueId) throw new ApiError(400, "Name a tagTypeId or a tagValueId");
  return NextResponse.json(await tagUsage(ctx, { tagTypeId: tagTypeId ?? undefined, tagValueId: tagValueId ?? undefined }));
});
