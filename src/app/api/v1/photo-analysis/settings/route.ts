import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

const bodySchema = z.object({ autoAnalyzePhotos: z.boolean() });

// PUT /api/v1/photo-analysis/settings — switch automatic analysis of vendor
// photos on or off for this organization. Every analysis is a paid AI call,
// so this is a cost decision, held by the same admins as the defect rules.
export const PUT = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canManageProperties");
  const { autoAnalyzePhotos } = bodySchema.parse(await req.json());
  await prisma.organization.update({ where: { id: ctx.organizationId }, data: { autoAnalyzePhotos } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "photo_analysis.settings_updated",
    entityType: "Organization",
    entityId: ctx.organizationId,
    metadata: { autoAnalyzePhotos },
  });
  return NextResponse.json({ autoAnalyzePhotos });
});
