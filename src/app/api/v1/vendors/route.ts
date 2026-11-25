import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createContractor, listContractors } from "@/lib/contractor-service";

// GET /api/v1/vendors?propertyId=&trade= — the organization's contractors,
// optionally only those that serve one store or do one trade.
export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const items = await listContractors(ctx, {
    propertyId: url.searchParams.get("propertyId") ?? undefined,
    trade: url.searchParams.get("trade") ?? undefined,
  });
  return NextResponse.json({ items });
});

// POST — add a contractor. The shape and rules are `contractorSchema`.
export const POST = withApiHandler(async (ctx, req) => {
  return NextResponse.json(await createContractor(ctx, await req.json()), { status: 201 });
});
