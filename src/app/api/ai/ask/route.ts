import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { askPropertyAI } from "@/lib/ai/gateway";
import { z } from "zod";

const schema = z.object({
  question: z.string().min(1).max(2000),
  propertyId: z.string().optional(),
  propertyName: z.string().optional(),
});

// POST /api/ai/ask — "Ask Property AI" (spec §25-§31). Gated by canViewAI,
// which every role except Vendor and Technician has by default.
export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canViewAI");
  const body = await req.json();
  const input = schema.parse(body);

  const result = await askPropertyAI(
    ctx,
    input.question,
    input.propertyId ? `${input.propertyName ?? input.propertyId} (propertyId: ${input.propertyId})` : undefined,
  );

  return NextResponse.json(result);
});
