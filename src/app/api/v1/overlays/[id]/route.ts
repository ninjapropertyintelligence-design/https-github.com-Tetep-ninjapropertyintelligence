import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { deleteOverlay, updateOverlay } from "@/lib/overlay-service";
import { OverlayCategory } from "@/generated/prisma/enums";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.enum(OverlayCategory).optional(),
  defaultOpacity: z.number().min(0).max(1).optional(),
  isDefault: z.boolean().optional(),
  capturedAt: z.coerce.date().nullish(),
  north: z.number().optional(),
  south: z.number().optional(),
  east: z.number().optional(),
  west: z.number().optional(),
});

export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await updateOverlay(ctx, id, schema.parse(await req.json())));
});

export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  await deleteOverlay(ctx, id);
  return NextResponse.json({ deleted: true });
});
