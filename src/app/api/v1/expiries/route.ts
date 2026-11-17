import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createExpiry, listExpiries } from "@/lib/expiry-service";
import { ExpiryStatus } from "@/generated/prisma/client";

// GET /api/v1/expiries?propertyId=&assetId=&status=ACTIVE|RENEWED|DISMISSED|ALL&withinDays=
export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const withinDays = url.searchParams.get("withinDays");
  const items = await listExpiries(ctx, {
    propertyId: url.searchParams.get("propertyId") ?? undefined,
    assetId: url.searchParams.get("assetId") ?? undefined,
    status: status === "ALL" || (status && status in ExpiryStatus) ? (status as ExpiryStatus | "ALL") : undefined,
    withinDays: withinDays !== null && Number.isFinite(Number(withinDays)) ? Number(withinDays) : undefined,
  });
  return NextResponse.json({ items });
});

// POST — add something that expires. The shape and rules are `createExpirySchema`.
export const POST = withApiHandler(async (ctx, req) => {
  return NextResponse.json(await createExpiry(ctx, await req.json()), { status: 201 });
});
