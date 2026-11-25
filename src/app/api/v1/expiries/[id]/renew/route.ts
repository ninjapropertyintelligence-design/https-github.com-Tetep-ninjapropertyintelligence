import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { renewExpiry } from "@/lib/expiry-service";

type RouteParams = { params: Promise<{ id: string }> };

// POST — renew: the old record is kept as renewed and a new one starts counting down.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await renewExpiry(ctx, id, await req.json()), { status: 201 });
});
