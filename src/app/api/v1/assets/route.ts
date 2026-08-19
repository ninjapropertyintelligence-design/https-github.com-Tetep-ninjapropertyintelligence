import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { createAssetSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { recalculatePropertyHealth } from "@/lib/scoring";

// GET /api/v1/assets?propertyId=&assetType=&criticality=&status=&search=&page=&pageSize=
export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const propertyId = url.searchParams.get("propertyId");
  const assetType = url.searchParams.get("assetType");
  const criticality = url.searchParams.get("criticality");
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "25")));

  const where: Prisma.AssetWhereInput = {
    organizationId: ctx.organizationId,
    property: propertyScopeWhere(ctx),
  };
  if (propertyId) where.propertyId = propertyId;
  if (assetType) where.assetType = assetType;
  if (criticality) where.criticalityScore = Number(criticality);
  if (status) where.status = status as never;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { serialNumber: { contains: search, mode: "insensitive" } },
      { customerAssetId: { contains: search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { property: { select: { id: true, name: true } }, system: true },
    }),
    prisma.asset.count({ where }),
  ]);

  return NextResponse.json({ items, total, page, pageSize });
});

// POST /api/v1/assets
export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canManageAssets");
  const body = await req.json();
  const input = createAssetSchema.parse(body);

  const property = await prisma.property.findFirst({
    where: { AND: [{ id: input.propertyId }, propertyScopeWhere(ctx)] },
  });
  if (!property) throw new ApiError(400, "Invalid propertyId, or you don't have access to it");

  if (input.customerAssetId) {
    const dup = await prisma.asset.findFirst({
      where: { organizationId: ctx.organizationId, customerAssetId: input.customerAssetId },
    });
    if (dup) throw new ApiError(409, "An asset with this customerAssetId already exists");
  }

  const asset = await prisma.asset.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: input.propertyId,
      buildingId: input.buildingId ?? null,
      floorId: input.floorId ?? null,
      areaId: input.areaId ?? null,
      systemId: input.systemId ?? null,
      name: input.name,
      assetType: input.assetType,
      customerAssetId: input.customerAssetId ?? null,
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      serialNumber: input.serialNumber ?? null,
      installedAt: input.installedAt ?? null,
      expectedUsefulLifeYears: input.expectedUsefulLifeYears ?? null,
      criticalityScore: input.criticalityScore,
      replacementCost: input.replacementCost ?? null,
      conditionScore: input.conditionScore ?? null,
      healthScore: input.conditionScore ?? null,
      updatedBy: ctx.userId,
    },
  });

  await recalculatePropertyHealth(input.propertyId);

  await Promise.all([
    emitEvent({
      organizationId: ctx.organizationId,
      propertyId: input.propertyId,
      type: EVENT_TYPES.ASSET_CREATED,
      actorUserId: ctx.userId,
      payload: { assetId: asset.id, name: asset.name },
    }),
    writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "asset.created",
      entityType: "Asset",
      entityId: asset.id,
    }),
  ]);

  return NextResponse.json(asset, { status: 201 });
});
