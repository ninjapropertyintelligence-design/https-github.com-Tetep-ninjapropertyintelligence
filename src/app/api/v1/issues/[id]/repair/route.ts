import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { sendBackRepair, startRepair, submitRepair, verifyRepair } from "@/lib/repair-service";

type RouteParams = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion("action", [
  // The repairer: started, and done (with what they did and what it cost).
  z.object({ action: z.literal("start") }),
  z.object({
    action: z.literal("submit"),
    notes: z.string().max(5000),
    actualCost: z.number().int().nonnegative().nullish(),
  }),
  // A reviewer: accept, optionally recording the asset's new condition; or send back.
  z.object({
    action: z.literal("verify"),
    conditionScore: z.number().int().min(0).max(100).nullish(),
    note: z.string().max(1000).nullish(),
  }),
  z.object({ action: z.literal("send_back"), reason: z.string().max(1000) }),
]);

// POST /api/v1/issues/:id/repair — the repair's steps. Who may take each one
// is decided in repair-service, not here.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const body = bodySchema.parse(await req.json());
  switch (body.action) {
    case "start":
      return NextResponse.json(await startRepair(ctx, id));
    case "submit":
      return NextResponse.json(await submitRepair(ctx, id, { notes: body.notes, actualCost: body.actualCost }));
    case "verify":
      return NextResponse.json(await verifyRepair(ctx, id, { conditionScore: body.conditionScore, note: body.note }));
    case "send_back":
      return NextResponse.json(await sendBackRepair(ctx, id, body.reason));
  }
});
