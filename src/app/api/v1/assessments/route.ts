import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { assertProjectForAssessment } from "@/lib/project-service";
import { z } from "zod";

// GET /api/v1/assessments?propertyId=&status=&mine=true
export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const propertyId = url.searchParams.get("propertyId");
  const status = url.searchParams.get("status");
  const mine = url.searchParams.get("mine") === "true";

  const items = await prisma.assessment.findMany({
    where: {
      organizationId: ctx.organizationId,
      property: propertyScopeWhere(ctx),
      ...(propertyId ? { propertyId } : {}),
      ...(status ? { status: status as never } : {}),
      ...(mine ? { inspectorId: ctx.userId } : {}),
    },
    orderBy: { scheduledFor: "asc" },
    include: {
      property: { select: { id: true, name: true, city: true, state: true } },
      template: { select: { id: true, name: true } },
      inspector: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ items });
});

const createAssessmentSchema = z.object({
  propertyId: z.string().min(1),
  templateId: z.string().min(1),
  inspectorId: z.string().min(1).optional(),
  scheduledFor: z.coerce.date().nullish(),
  projectId: z.string().min(1).nullish(),
});

// POST /api/v1/assessments — schedule/start an assessment instance from a template.
export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canPerformAssessments");
  const body = await req.json();
  const input = createAssessmentSchema.parse(body);

  const property = await prisma.property.findFirst({
    where: { AND: [{ id: input.propertyId }, propertyScopeWhere(ctx)] },
  });
  if (!property) throw new ApiError(400, "Invalid propertyId, or you don't have access to it");

  const template = await prisma.assessmentTemplate.findFirst({
    where: { id: input.templateId, organizationId: ctx.organizationId },
  });
  if (!template) throw new ApiError(400, "Invalid templateId");
  // A retired template keeps answering for the assessments already run on it,
  // but new work goes on its replacement.
  if (!template.isActive) throw new ApiError(400, "That template has been retired; use its current version");
  if (input.projectId) await assertProjectForAssessment(ctx, input.projectId, input.propertyId);
  // The inspector id was taken on trust: anyone could be named, including a
  // user in another organization, who would then be "assigned" work here.
  if (input.inspectorId && input.inspectorId !== ctx.userId) {
    const member = await prisma.membership.findFirst({
      where: { userId: input.inspectorId, organizationId: ctx.organizationId },
    });
    if (!member) throw new ApiError(400, "That inspector is not a member of this organization");
  }

  const assessment = await prisma.assessment.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: input.propertyId,
      templateId: input.templateId,
      inspectorId: input.inspectorId ?? ctx.userId,
      scheduledFor: input.scheduledFor ?? null,
      projectId: input.projectId ?? null,
      status: "DRAFT",
    },
  });

  await emitEvent({
    organizationId: ctx.organizationId,
    propertyId: input.propertyId,
    type: EVENT_TYPES.ASSESSMENT_STARTED,
    actorUserId: ctx.userId,
    payload: { assessmentId: assessment.id, templateName: template.name },
  });

  return NextResponse.json(assessment, { status: 201 });
});
