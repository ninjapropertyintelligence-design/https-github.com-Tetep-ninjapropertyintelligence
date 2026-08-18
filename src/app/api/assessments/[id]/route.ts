import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { writeAuditLog } from "@/lib/audit";
import { recalculatePropertyHealth } from "@/lib/scoring";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

async function loadScopedAssessment(ctx: Parameters<typeof propertyScopeWhere>[0], id: string) {
  const assessment = await prisma.assessment.findFirst({
    where: { AND: [{ id }, { property: propertyScopeWhere(ctx) }] },
    include: {
      property: { select: { id: true, name: true } },
      template: { include: { sections: { include: { questions: true }, orderBy: { position: "asc" } } } },
      answers: true,
      inspector: { select: { id: true, name: true } },
    },
  });
  if (!assessment) throw new ApiError(404, "Assessment not found");
  return assessment;
}

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const assessment = await loadScopedAssessment(ctx, id);
  return NextResponse.json(assessment);
});

const patchSchema = z.object({
  status: z.enum(["DRAFT", "IN_PROGRESS", "COMPLETED"]).optional(),
});

export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const existing = await loadScopedAssessment(ctx, id);
  const body = await req.json();
  const input = patchSchema.parse(body);

  const completing = input.status === "COMPLETED" && existing.status !== "COMPLETED";

  const updated = await prisma.assessment.update({
    where: { id: existing.id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.status === "IN_PROGRESS" && !existing.startedAt ? { startedAt: new Date() } : {}),
      ...(completing ? { completedAt: new Date() } : {}),
    },
  });

  if (completing) {
    await recalculatePropertyHealth(existing.propertyId);
    await Promise.all([
      emitEvent({
        organizationId: ctx.organizationId,
        propertyId: existing.propertyId,
        type: EVENT_TYPES.ASSESSMENT_COMPLETED,
        actorUserId: ctx.userId,
        payload: { assessmentId: updated.id, templateName: existing.template.name },
      }),
      writeAuditLog({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "assessment.completed",
        entityType: "Assessment",
        entityId: updated.id,
      }),
    ]);
  }

  return NextResponse.json(updated);
});
