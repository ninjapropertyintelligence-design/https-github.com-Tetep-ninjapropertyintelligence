import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { setAssetContractor, whoToCall } from "@/lib/contractor-service";

type RouteParams = { params: Promise<{ id: string }> };

// GET — who to call for this asset: its own contractor, then the others at its store.
export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await whoToCall(ctx, id));
});

const schema = z.object({ vendorId: z.string().min(1).nullable() });

// PUT — name the contractor that services this asset, or clear it with null.
export const PUT = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const { vendorId } = schema.parse(await req.json());
  await setAssetContractor(ctx, id, vendorId);
  return NextResponse.json({ vendorId });
});
