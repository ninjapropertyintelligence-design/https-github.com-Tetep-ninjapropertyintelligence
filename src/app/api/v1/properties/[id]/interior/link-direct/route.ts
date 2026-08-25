import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { linkSpaceByIdDirect } from "@/lib/matterport-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({
  // Matterport space IDs are short alphanumeric handles (the `m=` value in a
  // Showcase URL). Accepting a full URL too, since that's what a user
  // actually has in front of them, and extracting the ID from it.
  externalSpaceId: z.string().min(1).max(200),
  name: z.string().max(200).optional(),
});

/** Pulls the space ID out of a Showcase URL, or returns the input unchanged. */
function normalizeSpaceId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/[?&]m=([A-Za-z0-9]+)/);
  if (match) return match[1];
  return trimmed;
}

// POST /api/v1/properties/[id]/interior/link-direct — link a Matterport space
// by ID without a Model API call (viewer-only path; see linkSpaceByIdDirect).
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canPerformCapture");
  const { id } = await params;
  const input = schema.parse(await req.json());
  const link = await linkSpaceByIdDirect(ctx, id, normalizeSpaceId(input.externalSpaceId), input.name);
  return NextResponse.json(link, { status: 201 });
});
