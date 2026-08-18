import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { getLatestHealthSnapshot } from "@/lib/scoring";
import { healthBandFor } from "@/lib/scoring-categories";
import { updatePropertySchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";

async function loadScopedProperty(ctx: Parameters<typeof propertyScopeWhere>[0], id: string) {
  const property = await prisma.property.findFirst({
    where: { AND: [{ id }, propertyScopeWhere(ctx)] },
    include: { region: true, portfolio: true, buildings: true },
  });
  // A property that exists but is outside the caller's tenant/scope returns
  // the same 404 as one that doesn't exist at all — never reveal existence
  // of another org's (or another region's) data via a 403 vs 404 distinction.
  if (!property) throw new ApiError(404, "Property not found");
  return property;
}

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const property = await loadScopedProperty(ctx, id);
  const [health, openIssueCount, criticalIssueCount, assetCount, criticalAssetCount] =
    await Promise.all([
      getLatestHealthSnapshot(property.id),
      prisma.issue.count({
        where: { propertyId: property.id, status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } },
      }),
      prisma.issue.count({
        where: {
          propertyId: property.id,
          severity: "CRITICAL",
          status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] },
        },
      }),
      prisma.asset.count({ where: { propertyId: property.id, status: "ACTIVE" } }),
      prisma.asset.count({ where: { propertyId: property.id, status: "ACTIVE", criticalityScore: { gte: 4 } } }),
    ]);

  return NextResponse.json({
    ...property,
    health: health
      ? { ...health, band: healthBandFor(health.healthScore) }
      : null,
    openIssueCount,
    criticalIssueCount,
    assetCount,
    criticalAssetCount,
  });
});

export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canManageProperties");
  const { id } = await params;
  const existing = await loadScopedProperty(ctx, id);

  const body = await req.json();
  const input = updatePropertySchema.parse(body);

  if (input.version !== existing.version) {
    throw new ApiError(409, "Property was modified by someone else — reload and retry");
  }

  const updated = await prisma.property.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1 } : {}),
      ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2 } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
      ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
      ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      ...(input.propertyType !== undefined ? { propertyType: input.propertyType } : {}),
      ...(input.squareFootage !== undefined ? { squareFootage: input.squareFootage } : {}),
      ...(input.yearBuilt !== undefined ? { yearBuilt: input.yearBuilt } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedBy: ctx.userId,
      version: { increment: 1 },
    },
  });

  await Promise.all([
    emitEvent({
      organizationId: ctx.organizationId,
      propertyId: updated.id,
      type: EVENT_TYPES.PROPERTY_UPDATED,
      actorUserId: ctx.userId,
      payload: { fields: Object.keys(input) },
    }),
    writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "property.updated",
      entityType: "Property",
      entityId: updated.id,
      metadata: { fields: Object.keys(input) },
    }),
  ]);

  return NextResponse.json(updated);
});
