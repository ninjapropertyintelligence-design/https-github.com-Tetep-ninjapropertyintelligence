import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { pinAssetToTour, removeTourPin } from "@/lib/asset-location-service";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({ url: z.string().min(1).max(2000), label: z.string().max(200).nullish() });

// POST — pin this equipment to a spot in the store's 3D tour, from a Matterport link copied while standing there.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const input = schema.parse(await req.json());
  return NextResponse.json(await pinAssetToTour(ctx, id, input), { status: 201 });
});

// DELETE ?pinId= — remove a pin.
export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const pinId = new URL(req.url).searchParams.get("pinId");
  if (!pinId) return NextResponse.json({ error: "pinId is required" }, { status: 400 });
  await removeTourPin(ctx, id, pinId);
  return NextResponse.json({ removed: true });
});
