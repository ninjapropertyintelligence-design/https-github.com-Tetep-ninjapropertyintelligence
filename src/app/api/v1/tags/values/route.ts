import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createTagValue } from "@/lib/tag-service";
import { z } from "zod";

const schema = z.object({ tagTypeId: z.string().min(1), name: z.string().min(1).max(100), propertyId: z.string().nullish() });

export const POST = withApiHandler(async (ctx, req) => NextResponse.json(await createTagValue(ctx, schema.parse(await req.json())), { status: 201 }));
