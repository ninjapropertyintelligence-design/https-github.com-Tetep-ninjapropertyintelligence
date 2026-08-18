import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { assetConditionChangeSchema } from "@/lib/validation";
import { recordAssetConditionChange } from "@/lib/asset-condition";
import { writeAuditLog } from "@/lib/audit";

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/assets/[id]/condition — the one endpoint that changes an asset's
// condition. Always appends AssetConditionHistory, never overwrites (spec §10).
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canManageAssets");
  const { id } = await params;

  const asset = await prisma.asset.findFirst({
    where: { AND: [{ id }, { property: propertyScopeWhere(ctx) }] },
  });
  if (!asset) throw new ApiError(404, "Asset not found");

  const body = await req.json();
  const input = assetConditionChangeSchema.parse(body);

  const updated = await recordAssetConditionChange({
    assetId: asset.id,
    newScore: input.newScore,
    changedByUserId: ctx.userId,
    reason: input.reason,
    evidenceId: input.evidenceId,
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "asset.condition_changed",
    entityType: "Asset",
    entityId: asset.id,
    metadata: { previousScore: asset.conditionScore, newScore: input.newScore, reason: input.reason },
  });

  return NextResponse.json(updated);
});
