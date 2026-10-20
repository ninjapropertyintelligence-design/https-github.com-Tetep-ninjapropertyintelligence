import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { saveAnswer } from "@/lib/assessment-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const answerSchema = z.object({
  questionId: z.string().min(1),
  taskResponseId: z.string().nullish(),
  assetId: z.string().nullish(),
  textValue: z.string().nullish(),
  numberValue: z.number().nullish(),
  boolValue: z.boolean().nullish(),
  conditionValue: z.number().min(0).max(100).nullish(),
  selectValues: z.array(z.string()).default([]),
});

// POST /api/v1/assessments/[id]/answers — save one answer. See `saveAnswer`.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const input = answerSchema.parse(await req.json());
  return NextResponse.json(await saveAnswer(ctx, id, input), { status: 201 });
});
