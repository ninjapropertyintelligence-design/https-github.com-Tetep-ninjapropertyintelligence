import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { addStandardTagTypes } from "@/lib/tag-service";

// POST — add the standard Level / Area / Type / Category / Tag vocabulary the organization lacks.
export const POST = withApiHandler(async (ctx) => NextResponse.json({ items: await addStandardTagTypes(ctx) }));
