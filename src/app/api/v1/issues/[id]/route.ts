import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { issueScopeWhere } from "@/lib/session-context";
import { updateIssueSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { recalculatePropertyHealth } from "@/lib/scoring";
import { notifyUser, notifyVendorUsers } from "@/lib/notifications";
import { Role } from "@/generated/prisma/client";

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
  // A vendor reports its repair through the repair actions — start, notes,
  // photos, done — and never edits the problem itself: its title, severity,
  // estimate or who it is assigned to.
  if (ctx.role === Role.VENDOR) {
    throw new ApiError(403, "Vendors update a repair with Start work and Repair done, not by editing the issue");
  }
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
  // "Verified" means someone checked the fix. It is given by whoever may
  // check repairs, never by status dropdown alone.
  if (input.status === "VERIFIED" && existing.status !== "VERIFIED") {
    requirePermission(ctx, "canVerifyRepairs");
  }

  // Sending a vendor puts the issue in its hands, so an untouched issue moves
  // to ASSIGNED unless the caller set a status of their own.
  const newlyAssignedVendor = input.vendorId && input.vendorId !== existing.vendorId ? input.vendorId : null;
  if (newlyAssignedVendor) {
    const vendor = await prisma.vendor.findFirst({
      where: { id: newlyAssignedVendor, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!vendor) throw new ApiError(400, "That vendor company does not exist in this organization");
  }
  // An assignee is someone in this organization who can act on issues — not a
  // stranger's user id, and not a read-only viewer who could never fix it.
  if (input.assigneeId && input.assigneeId !== existing.assigneeId) {
    const member = await prisma.membership.findFirst({
      where: {
        userId: input.assigneeId,
        organizationId: ctx.organizationId,
        role: { notIn: [Role.VIEWER, Role.VENDOR] },
      },
      select: { id: true },
    });
    if (!member) throw new ApiError(400, "Assign the issue to a member of this organization who can work on it");
  }
  const autoStatus =
    (newlyAssignedVendor || (input.assigneeId && input.assigneeId !== existing.assigneeId)) &&
    input.status === undefined &&
    (existing.status === "OPEN" || existing.status === "TRIAGED")
      ? ("ASSIGNED" as const)
      : undefined;

  const updated = await prisma.issue.update({
    where: { id: existing.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.severity !== undefined ? { severity: input.severity } : {}),
      ...(input.status !== undefined ? { status: input.status } : autoStatus ? { status: autoStatus } : {}),
      ...(input.status === "VERIFIED" && existing.status !== "VERIFIED"
        ? { verifiedAt: new Date(), verifiedById: ctx.userId }
        : {}),
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
      ? notifyUser({
          organizationId: ctx.organizationId,
          userId: input.assigneeId,
          type: "ISSUE_ASSIGNED",
          title: `Assigned: ${updated.title}`,
          link: `/issues/${updated.id}`,
        })
      : Promise.resolve(),
    newlyAssignedVendor
      ? notifyVendorUsers({
          organizationId: ctx.organizationId,
          vendorId: newlyAssignedVendor,
          type: "ISSUE_ASSIGNED",
          title: `Repair assigned: ${updated.title}`,
          body: existing.property.name,
          link: `/issues/${updated.id}`,
        })
      : Promise.resolve(),
  ]);

  return NextResponse.json(updated);
});
