import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { confirmFinding, rejectFinding } from "@/lib/ai-finding-service";
import { IssueSeverity } from "@/generated/prisma/client";

type RouteParams = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion("action", [
  // Every override is optional; a blank one falls back to the organization's rule.
  z.object({
    action: z.literal("confirm"),
    severity: z.nativeEnum(IssueSeverity).nullish(),
    repairCostCents: z.number().int().nonnegative().nullish(),
    conditionPenalty: z.number().int().min(0).max(100).nullish(),
    assetId: z.string().nullish(),
    title: z.string().max(200).nullish(),
    note: z.string().max(2000).nullish(),
  }),
  z.object({ action: z.literal("reject"), note: z.string().max(2000).nullish() }),
]);

// POST /api/v1/ai-findings/:id — an inspector's decision on one finding.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const body = bodySchema.parse(await req.json());
  if (body.action === "reject") {
    await rejectFinding(ctx, id, body.note);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(
    await confirmFinding(ctx, id, {
      severity: body.severity,
      repairCostCents: body.repairCostCents,
      conditionPenalty: body.conditionPenalty,
      assetId: body.assetId,
      title: body.title,
      note: body.note,
    }),
  );
});
