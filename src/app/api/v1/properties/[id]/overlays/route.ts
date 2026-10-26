import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createOverlay, listOverlays } from "@/lib/overlay-service";
import { OverlayCategory, OverlayKind } from "@/generated/prisma/enums";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  return NextResponse.json({ items: await listOverlays(ctx, id) });
});

const schema = z.object({
  kind: z.enum(OverlayKind),
  category: z.enum(OverlayCategory).optional(),
  name: z.string().min(1).max(200),
  storageKey: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  floorId: z.string().nullish(),
  north: z.number().nullish(),
  south: z.number().nullish(),
  east: z.number().nullish(),
  west: z.number().nullish(),
  defaultOpacity: z.number().min(0).max(1).optional(),
  isDefault: z.boolean().optional(),
  capturedAt: z.coerce.date().nullish(),
});

// POST — register an uploaded file as an overlay on this property.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const input = schema.parse(await req.json());
  return NextResponse.json(await createOverlay(ctx, { ...input, propertyId: id }), { status: 201 });
});
