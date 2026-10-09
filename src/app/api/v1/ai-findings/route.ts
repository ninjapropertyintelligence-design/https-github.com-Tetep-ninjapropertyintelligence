import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { listFindings } from "@/lib/ai-finding-service";

const statusSchema = z.enum(["SUGGESTED", "HUMAN_VERIFIED", "REJECTED"]).default("SUGGESTED");

// GET /api/v1/ai-findings?status=SUGGESTED — the review queue, scoped to what the caller can see.
export const GET = withApiHandler(async (ctx, req) => {
  const status = statusSchema.parse(new URL(req.url).searchParams.get("status") ?? undefined);
  return NextResponse.json({ items: await listFindings(ctx, status) });
});
