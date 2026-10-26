import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { changeAssessmentStatus, getAssessmentDetail, progressFor } from "@/lib/assessment-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const assessment = await getAssessmentDetail(ctx, id);
  if (!assessment) throw new ApiError(404, "Assessment not found");
  return NextResponse.json({ ...assessment, progress: await progressFor(assessment) });
});

const patchSchema = z.object({
  status: z.enum(["DRAFT", "IN_PROGRESS", "COMPLETED", "RELEASED"]),
});

// PATCH /api/v1/assessments/[id] — move it through its life; the rules are in `changeAssessmentStatus`.
export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const input = patchSchema.parse(await req.json());
  return NextResponse.json(await changeAssessmentStatus(ctx, id, input.status));
});
