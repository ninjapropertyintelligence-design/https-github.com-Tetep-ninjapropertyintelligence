import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { dismissExpiry, getExpiry, updateExpiry } from "@/lib/expiry-service";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await getExpiry(ctx, id));
});

// PATCH — change details, correct the date, or confirm a date read from a photo ({ "confirmed": true }).
export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await updateExpiry(ctx, id, await req.json()));
});

// DELETE — stop counting down something that no longer applies.
export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  await dismissExpiry(ctx, id);
  return NextResponse.json({ dismissed: true });
});
