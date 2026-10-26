import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createProgram, listPrograms } from "@/lib/project-service";
import { z } from "zod";

export const GET = withApiHandler(async (ctx) => NextResponse.json({ items: await listPrograms(ctx) }));

const schema = z.object({ name: z.string().min(1).max(200), description: z.string().max(2000).nullish() });

export const POST = withApiHandler(async (ctx, req) => {
  const input = schema.parse(await req.json());
  return NextResponse.json(await createProgram(ctx, input), { status: 201 });
});
