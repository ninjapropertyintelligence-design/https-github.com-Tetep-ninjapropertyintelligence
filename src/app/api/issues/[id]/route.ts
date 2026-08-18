import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { issueScopeWhere } from "@/lib/session-context";
import { updateIssueSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { recalculatePropertyHealth } from "@/lib/scoring";

type RouteParams = { params: Promise<{ id: string }> };

async function loadScopedIssue(ctx: Parameters<typeof issueScopeWhere>[0], id: string) {
  const issue = await prisma.issue.findFirst({
    where: { AND: [{ id }, issueScopeWhere(ctx)] },
    include: {
      property: { select: { id: true, name: true } },
      asset: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true } },
      comments: { orderBy: { createdAt: "asc" } },
      evidence: true,
      documents: true,
    },
  });
  if (!issue) throw new ApiError(404, "Issue not found");
  return issue;
}

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const issue = await loadScopedIssue(ctx, id);
  return NextResponse.json(issue);
});

export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const existing = await loadScopedIssue(ctx, id);

  const body = await req.json();
  const input = updateIssueSchema.parse(body);
  if (input.version !== existing.version) {
    throw new ApiError(409, "Issue was modified by someone else — reload and retry");
  }

  const resolving =
    input.status &&
    ["RESOLVED", "VERIFIED", "CLOSED"].includes(input.status) &&
    !["RESOLVED", "VERIFIED", "CLOSED"].includes(existing.status);

  // Resolving requires canResolveIssues; any other edit requires canCreateIssues
  // (assignment/triage) which every role that can raise issues can also update.
  requirePermission(ctx, resolving ? "canResolveIssues" : "canCreateIssues");

  const updated = await prisma.issue.update({
    where: { id: existing.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.severity !== undefined ? { severity: input.severity } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
      ...(input.estimatedCost !== undefined ? { estimatedCost: input.estimatedCost } : {}),
      ...(input.actualCost !== undefined ? { actualCost: input.actualCost } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(resolving ? { resolvedById: ctx.userId, resolvedAt: new Date() } : {}),
      version: { increment: 1 },
    },
  });

  if (input.estimatedCost !== undefined || input.status !== undefined) {
    await recalculatePropertyHealth(existing.propertyId);
  }

  await Promise.all([
    emitEvent({
      organizationId: ctx.organizationId,
      propertyId: existing.propertyId,
      type: resolving ? EVENT_TYPES.ISSUE_RESOLVED : EVENT_TYPES.ISSUE_ASSIGNED,
      actorUserId: ctx.userId,
      payload: { issueId: updated.id, fields: Object.keys(input) },
    }),
    writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: resolving ? "issue.resolved" : "issue.updated",
      entityType: "Issue",
      entityId: updated.id,
      metadata: { fields: Object.keys(input) },
    }),
    input.assigneeId && input.assigneeId !== existing.assigneeId
      ? prisma.notification.create({
          data: {
            organizationId: ctx.organizationId,
            userId: input.assigneeId,
            type: "ISSUE_ASSIGNED",
            title: `Assigned: ${updated.title}`,
            link: `/issues/${updated.id}`,
          },
        })
      : Promise.resolve(),
  ]);

  return NextResponse.json(updated);
});
