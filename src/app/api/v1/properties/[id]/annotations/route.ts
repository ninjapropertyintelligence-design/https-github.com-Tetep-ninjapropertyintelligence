import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createAnnotation, listAnnotations } from "@/lib/annotation-service";
import { SiteAnnotationKind } from "@/generated/prisma/enums";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  return NextResponse.json({ items: await listAnnotations(ctx, id) });
});

const schema = z.object({
  kind: z.enum(SiteAnnotationKind),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  color: z.string().max(7).nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  // Shape is checked by the service, which names what is wrong.
  polygon: z.array(z.array(z.number())).max(201).nullish(),
});

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await createAnnotation(ctx, id, schema.parse(await req.json())), { status: 201 });
});
