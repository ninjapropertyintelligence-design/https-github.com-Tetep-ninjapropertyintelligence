import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { deleteAnnotation, updateAnnotation } from "@/lib/annotation-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullish(),
  color: z.string().max(7).nullish(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  polygon: z.array(z.array(z.number())).max(201).optional(),
});

export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await updateAnnotation(ctx, id, patchSchema.parse(await req.json())));
});

export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  await deleteAnnotation(ctx, id);
  return NextResponse.json({ deleted: true });
});
