import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { reviewAIFinding } from "@/lib/ai/photo-analysis";

type RouteParams = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  decision: z.enum(["confirm", "reject"]),
  // The reviewer's own score, when they disagree with the AI's.
  score: z.number().int().min(0).max(100).nullish(),
  note: z.string().max(1000).nullish(),
});

// POST /api/v1/ai-findings/:id/review — a person confirms or rejects an AI
// photo suggestion. Confirming is what writes the asset's condition.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canUploadEvidence");
  const { id } = await params;
  const body = bodySchema.parse(await req.json());
  return NextResponse.json(await reviewAIFinding(ctx, id, body));
});
