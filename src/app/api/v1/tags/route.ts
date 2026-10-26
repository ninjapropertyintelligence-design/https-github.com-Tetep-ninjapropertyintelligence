import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { getVocabulary } from "@/lib/tag-service";

// GET /api/v1/tags?propertyId= — tag types and the values offered (organization-wide, plus that property's own).
export const GET = withApiHandler(async (ctx, req) => {
  const propertyId = new URL(req.url).searchParams.get("propertyId");
  return NextResponse.json({ items: await getVocabulary(ctx, propertyId) });
});
