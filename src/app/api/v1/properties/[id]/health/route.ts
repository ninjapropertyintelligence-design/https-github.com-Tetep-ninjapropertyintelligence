import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { getLatestHealthSnapshot, recalculatePropertyHealth } from "@/lib/scoring";
import { healthBandFor } from "@/lib/scoring-categories";

type RouteParams = { params: Promise<{ id: string }> };

async function assertScoped(ctx: Parameters<typeof propertyScopeWhere>[0], id: string) {
  const property = await prisma.property.findFirst({
    where: { AND: [{ id }, propertyScopeWhere(ctx)] },
    select: { id: true },
  });
  if (!property) throw new ApiError(404, "Property not found");
}

// GET: latest computed health snapshot (never invented client-side).
export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  await assertScoped(ctx, id);
  const snapshot = await getLatestHealthSnapshot(id);
  if (!snapshot) return NextResponse.json({ snapshot: null });
  return NextResponse.json({
    snapshot: { ...snapshot, band: healthBandFor(snapshot.healthScore) },
  });
});

// POST: force a recalculation (admin/debug tool — normal flow recalculates
// automatically whenever an asset condition or issue changes).
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  requirePermission(ctx, "canManageAssets");
  const { id } = await params;
  await assertScoped(ctx, id);
  const snapshot = await recalculatePropertyHealth(id);
  return NextResponse.json({ snapshot: { ...snapshot, band: healthBandFor(snapshot.healthScore) } });
});
