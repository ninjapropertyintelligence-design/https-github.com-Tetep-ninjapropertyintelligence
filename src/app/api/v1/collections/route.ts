import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { COLLECTION_SORTS, createCollection, listCollections } from "@/lib/collection-service";
import { CollectionVisibility } from "@/generated/prisma/enums";
import { z } from "zod";

const listSchema = z.object({
  q: z.string().max(200).nullish(),
  visibility: z.enum(CollectionVisibility).nullish(),
  creator: z.enum(["me"]).nullish(),
  sort: z.enum(COLLECTION_SORTS).nullish(),
});

// GET /api/v1/collections?q=&visibility=&creator=me&sort=recent|name|items
export const GET = withApiHandler(async (ctx, req) => {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json({ items: await listCollections(ctx, listSchema.parse(params)) });
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  visibility: z.enum(CollectionVisibility).optional(),
});

export const POST = withApiHandler(async (ctx, req) => {
  return NextResponse.json(await createCollection(ctx, createSchema.parse(await req.json())), { status: 201 });
});
