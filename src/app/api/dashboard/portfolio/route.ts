import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { getPortfolioDashboard } from "@/lib/dashboard";

// Thin HTTP wrapper — all computation lives in lib/dashboard.ts so the AI
// tool gateway can call the exact same function instead of recomputing.
export const GET = withApiHandler(async (ctx) => {
  const dashboard = await getPortfolioDashboard(ctx);
  return NextResponse.json(dashboard);
});
