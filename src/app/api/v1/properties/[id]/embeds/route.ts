import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createEmbed, listEmbeds } from "@/lib/embed-service";
import { SpatialEmbedKind } from "@/generated/prisma/enums";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  return NextResponse.json({ items: await listEmbeds(ctx, id) });
});

const schema = z.object({
  kind: z.enum(SpatialEmbedKind),
  name: z.string().min(1).max(200),
  url: z.string().min(1).max(2000),
  floorId: z.string().nullish(),
  capturedAt: z.coerce.date().nullish(),
});

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await createEmbed(ctx, { ...schema.parse(await req.json()), propertyId: id }), { status: 201 });
});
