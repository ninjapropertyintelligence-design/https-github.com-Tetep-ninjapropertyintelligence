import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { updateAssetSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { recalculatePropertyHealth } from "@/lib/scoring";

type RouteParams = { params: Promise<{ id: string }> };

async function loadScopedAsset(ctx: Parameters<typeof propertyScopeWhere>[0], id: string) {
  const asset = await prisma.asset.findFirst({
    where: { AND: [{ id }, { property: propertyScopeWhere(ctx) }] },
    include: {
      property: { select: { id: true, name: true } },
      system: true,
      conditionHistory: { orderBy: { changedAt: "desc" }, take: 20 },
    },
  });
  if (!asset) throw new ApiError(404, "Asset not found");
  return asset;
}

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const asset = await loadScopedAsset(ctx, id);
  const [openIssueCount, documentCount] = await Promise.all([
    prisma.issue.count({
      where: { assetId: asset.id, status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } },
    }),
    prisma.document.count({ where: { assetId: asset.id } }),
  ]);
  return NextResponse.json({ ...asset, openIssueCount, documentCount });
});

export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canManageAssets");
  const { id } = await params;
  const existing = await loadScopedAsset(ctx, id);

  const body = await req.json();
  const input = updateAssetSchema.parse(body);
  if (input.version !== existing.version) {
    throw new ApiError(409, "Asset was modified by someone else — reload and retry");
  }

  const updated = await prisma.asset.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.assetType !== undefined ? { assetType: input.assetType } : {}),
      ...(input.manufacturer !== undefined ? { manufacturer: input.manufacturer } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber } : {}),
      ...(input.installedAt !== undefined ? { installedAt: input.installedAt } : {}),
      ...(input.expectedUsefulLifeYears !== undefined
        ? { expectedUsefulLifeYears: input.expectedUsefulLifeYears }
        : {}),
      ...(input.criticalityScore !== undefined ? { criticalityScore: input.criticalityScore } : {}),
      ...(input.replacementCost !== undefined ? { replacementCost: input.replacementCost } : {}),
      ...(input.buildingId !== undefined ? { buildingId: input.buildingId } : {}),
      ...(input.floorId !== undefined ? { floorId: input.floorId } : {}),
      ...(input.areaId !== undefined ? { areaId: input.areaId } : {}),
      ...(input.systemId !== undefined ? { systemId: input.systemId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedBy: ctx.userId,
      version: { increment: 1 },
    },
  });

  await recalculatePropertyHealth(existing.propertyId);

  await Promise.all([
    emitEvent({
      organizationId: ctx.organizationId,
      propertyId: existing.propertyId,
      type: EVENT_TYPES.ASSET_UPDATED,
      actorUserId: ctx.userId,
      payload: { assetId: updated.id, fields: Object.keys(input) },
    }),
    writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "asset.updated",
      entityType: "Asset",
      entityId: updated.id,
      metadata: { fields: Object.keys(input) },
    }),
  ]);

  return NextResponse.json(updated);
});
