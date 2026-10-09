import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, requirePermission, withApiHandler } from "@/lib/api-utils";
import { PHOTO_ANALYSIS_RULE } from "@/lib/rate-limit";
import { analyzeEvidencePhoto } from "@/lib/ai/photo-analysis";

type RouteParams = { params: Promise<{ id: string }> };

const bodySchema = z.object({ assetId: z.string().min(1).nullish() });

// POST /api/v1/evidence/:id/analyze — the AI suggests a condition rating for
// the asset in this photo. A suggestion only: no score changes until someone
// confirms it at /api/v1/ai-findings/:id/review.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canUploadEvidence");
  enforceRateLimit(ctx, req, PHOTO_ANALYSIS_RULE, "ai.photo_analysis");
  const { id } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));
  const finding = await analyzeEvidencePhoto(ctx, id, { assetId: body.assetId });
  return NextResponse.json(finding, { status: 201 });
});
