import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { contextForDroneOutput } from "@/lib/session-context";
import { refreshOutputTiling, requestOutputTiling } from "@/lib/drone-map-service";

type RouteParams = { params: Promise<{ id: string }> };

// Streaming a multi-gigabyte map to Mapbox's staging area takes a while.
export const maxDuration = 300;

// GET …/tiles — where tiling for deep zoom stands (checks with Mapbox while it is running).
export const GET = withApiHandler<NextResponse, RouteParams>(async (session, req, { params }) => {
  const { id } = await params;
  const ctx = await contextForDroneOutput(session, id);
  return NextResponse.json({ tiling: await refreshOutputTiling(ctx, id) });
});

// POST …/tiles — send the full-resolution map to Mapbox to be tiled for deep zoom.
export const POST = withApiHandler<NextResponse, RouteParams>(async (session, req, { params }) => {
  const { id } = await params;
  const ctx = await contextForDroneOutput(session, id);
  return NextResponse.json({ tiling: await requestOutputTiling(ctx, id) });
});
