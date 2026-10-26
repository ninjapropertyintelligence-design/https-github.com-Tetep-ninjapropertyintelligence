import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { addToCollection, removeFromCollection } from "@/lib/collection-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const addSchema = z.object({ evidenceIds: z.array(z.string().min(1)).min(1).max(500) });

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await addToCollection(ctx, id, addSchema.parse(await req.json()).evidenceIds), { status: 201 });
});

const removeSchema = z.object({ evidenceId: z.string().min(1) });

export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  await removeFromCollection(ctx, id, removeSchema.parse(await req.json()).evidenceId);
  return NextResponse.json({ removed: true });
});
