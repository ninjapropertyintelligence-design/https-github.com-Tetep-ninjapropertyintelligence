import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createTagType } from "@/lib/tag-service";
import { z } from "zod";

const schema = z.object({ name: z.string().min(1).max(100), allowMultiple: z.boolean().optional() });

export const POST = withApiHandler(async (ctx, req) => NextResponse.json(await createTagType(ctx, schema.parse(await req.json())), { status: 201 }));
