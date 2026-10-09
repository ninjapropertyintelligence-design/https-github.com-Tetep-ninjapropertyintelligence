import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { listDefectRules, saveDefectRule } from "@/lib/ai-finding-service";
import { IssueSeverity } from "@/generated/prisma/client";

export const GET = withApiHandler(async (ctx) => {
  return NextResponse.json({ items: await listDefectRules(ctx) });
});

const ruleSchema = z.object({
  defectClass: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  assetCategory: z.string().max(100).nullish(),
  defaultSeverity: z.nativeEnum(IssueSeverity),
  conditionPenalty: z.number().int().min(0).max(100),
  defaultRepairCostCents: z.number().int().nonnegative().nullish(),
});

// POST /api/v1/defect-rules — create or replace the rule for a defect class.
export const POST = withApiHandler(async (ctx, req) => {
  return NextResponse.json(await saveDefectRule(ctx, ruleSchema.parse(await req.json())));
});
