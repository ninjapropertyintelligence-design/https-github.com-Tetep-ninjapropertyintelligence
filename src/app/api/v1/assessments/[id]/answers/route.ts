import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { recordAssetConditionChange } from "@/lib/asset-condition";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const answerSchema = z.object({
  questionId: z.string().min(1),
  assetId: z.string().nullish(),
  textValue: z.string().nullish(),
  numberValue: z.number().nullish(),
  boolValue: z.boolean().nullish(),
  conditionValue: z.number().min(0).max(100).nullish(),
  selectValues: z.array(z.string()).default([]),
});

/**
 * POST /api/v1/assessments/[id]/answers — save one answer. This is the concrete
 * implementation of the spec's assessment -> health-score flow (§12):
 * saving a CONDITION answer against an asset routes through the same
 * `recordAssetConditionChange` used everywhere else, so AssetConditionHistory,
 * Asset.healthScore, the Property health snapshot, the Event feed and the
 * dashboard all update from one write — no separate assessment-only path.
 */
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const assessment = await prisma.assessment.findFirst({
    where: { AND: [{ id }, { property: propertyScopeWhere(ctx) }] },
  });
  if (!assessment) throw new ApiError(404, "Assessment not found");
  if (assessment.status === "COMPLETED") {
    throw new ApiError(400, "Assessment is already completed and answers are locked");
  }

  const body = await req.json();
  const input = answerSchema.parse(body);

  const question = await prisma.assessmentQuestion.findFirst({
    where: { id: input.questionId, section: { templateId: assessment.templateId } },
  });
  if (!question) throw new ApiError(400, "Invalid questionId for this assessment's template");

  if (assessment.status === "DRAFT") {
    await prisma.assessment.update({ where: { id: assessment.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
  }

  // Not using `upsert` against the (assessmentId, questionId, assetId)
  // compound unique here: assetId is nullable, and findFirst/create/update
  // sidesteps any ambiguity around null handling in compound-unique lookups.
  const existingAnswer = await prisma.assessmentAnswer.findFirst({
    where: { assessmentId: assessment.id, questionId: input.questionId, assetId: input.assetId ?? null },
  });

  const answerData = {
    textValue: input.textValue ?? null,
    numberValue: input.numberValue ?? null,
    boolValue: input.boolValue ?? null,
    conditionValue: input.conditionValue ?? null,
    selectValues: input.selectValues,
  };

  const answer = existingAnswer
    ? await prisma.assessmentAnswer.update({ where: { id: existingAnswer.id }, data: answerData })
    : await prisma.assessmentAnswer.create({
        data: {
          assessmentId: assessment.id,
          questionId: input.questionId,
          assetId: input.assetId ?? null,
          ...answerData,
        },
      });

  if (question.type === "CONDITION" && input.assetId && input.conditionValue !== undefined && input.conditionValue !== null) {
    await recordAssetConditionChange({
      assetId: input.assetId,
      newScore: input.conditionValue,
      changedByUserId: ctx.userId,
      source: "ASSESSMENT",
      reason: `Assessment answer: ${question.prompt}`,
      validationStatus: "HUMAN_OBSERVED",
    });
  }

  return NextResponse.json(answer, { status: 201 });
});
