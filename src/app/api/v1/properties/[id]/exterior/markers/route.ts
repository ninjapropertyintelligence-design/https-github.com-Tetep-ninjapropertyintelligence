import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

// A marker must reference exactly one canonical record — never a
// duplicate business object (spec §23 "No Duplicate Data Rule").
const schema = z
  .object({
    droneImageId: z.string().optional(),
    droneOutputId: z.string().optional(),
    assetId: z.string().optional(),
    issueId: z.string().optional(),
    evidenceId: z.string().optional(),
    label: z.string().max(200).optional(),
    xNormalized: z.number().min(0).max(1),
    yNormalized: z.number().min(0).max(1),
  })
  .refine((v) => v.droneImageId || v.droneOutputId, { message: "A marker must be placed on either a drone image or a drone output" })
  .refine((v) => v.assetId || v.issueId || v.evidenceId, { message: "A marker must reference an asset, issue, or evidence record" });

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canManageAssets");
  const { id } = await params;
  const property = await prisma.property.findFirst({ where: { AND: [{ id }, propertyScopeWhere(ctx)] } });
  if (!property) throw new ApiError(404, "Property not found");

  const input = schema.parse(await req.json());

  if (input.assetId) {
    const asset = await prisma.asset.findFirst({ where: { id: input.assetId, propertyId: property.id } });
    if (!asset) throw new ApiError(400, "Invalid assetId for this property");
  }
  if (input.issueId) {
    const issue = await prisma.issue.findFirst({ where: { id: input.issueId, propertyId: property.id } });
    if (!issue) throw new ApiError(400, "Invalid issueId for this property");
  }
  if (input.evidenceId) {
    const evidence = await prisma.evidence.findFirst({ where: { id: input.evidenceId, propertyId: property.id } });
    if (!evidence) throw new ApiError(400, "Invalid evidenceId for this property");
  }

  const marker = await prisma.exteriorMarker.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: property.id,
      droneImageId: input.droneImageId,
      droneOutputId: input.droneOutputId,
      assetId: input.assetId,
      issueId: input.issueId,
      evidenceId: input.evidenceId,
      label: input.label,
      xNormalized: input.xNormalized,
      yNormalized: input.yNormalized,
      createdById: ctx.userId,
    },
  });

  return NextResponse.json(marker, { status: 201 });
});
