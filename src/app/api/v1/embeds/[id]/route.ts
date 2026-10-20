import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { deleteEmbed, updateEmbed } from "@/lib/embed-service";
import { SpatialEmbedKind } from "@/generated/prisma/enums";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  kind: z.enum(SpatialEmbedKind).optional(),
  name: z.string().min(1).max(200).optional(),
  url: z.string().min(1).max(2000).optional(),
  floorId: z.string().nullish(),
  capturedAt: z.coerce.date().nullish(),
});

export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await updateEmbed(ctx, id, patchSchema.parse(await req.json())));
});

export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  await deleteEmbed(ctx, id);
  return NextResponse.json({ deleted: true });
});
