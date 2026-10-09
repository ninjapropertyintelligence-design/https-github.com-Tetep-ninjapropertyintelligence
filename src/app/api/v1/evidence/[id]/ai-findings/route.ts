import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { recordFindings } from "@/lib/ai-finding-service";

type RouteParams = { params: Promise<{ id: string }> };

const unit = z.number().min(0).max(1);
const bodySchema = z.object({
  findings: z
    .array(
      z.object({
        defectClass: z.string().min(1).max(100),
        confidence: unit.nullish(),
        modelName: z.string().max(100).nullish(),
        assetId: z.string().nullish(),
        boundingBox: z.object({ x: unit, y: unit, w: unit, h: unit }).nullish(),
        imageWidth: z.number().int().positive().nullish(),
        imageHeight: z.number().int().positive().nullish(),
        description: z.string().max(2000).nullish(),
      }),
    )
    .min(1)
    .max(100),
});

// POST /api/v1/evidence/:id/ai-findings — a vision model's suggestions for
// one photo. They are recorded as SUGGESTED and change nothing else.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const { findings } = bodySchema.parse(await req.json());
  return NextResponse.json({ items: await recordFindings(ctx, id, findings) }, { status: 201 });
});
