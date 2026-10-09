import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { recordAssetConditionChange } from "@/lib/asset-condition";
import { recalculatePropertyHealth } from "@/lib/scoring";
import { hasPermission } from "@/lib/permissions";
import { issueScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { notifyPropertyStakeholders, notifyUser, notifyVendorUsers } from "@/lib/notifications";
import { IssueSource, IssueStatus, NotificationType, Role } from "@/generated/prisma/client";

/**
 * Repairs: someone is sent to fix an issue, proves they fixed it, and a
 * manager who looks after the building checks the proof.
 *
 *   assigned -> IN_PROGRESS (work started)
 *            -> RESOLVED    (repair done, after-photos attached, waiting)
 *            -> VERIFIED    (a reviewer accepted it)  or back to IN_PROGRESS
 *                                                     with the reason
 *
 * The repairer is the vendor company the issue is assigned to, or the staff
 * member it is assigned to. The repairer reports the work — notes, actual
 * cost, photos — and cannot change the problem itself, mark their own work
 * verified, or verify anyone's. A vendor's access to the building comes from
 * the open repair and ends when it is verified (see `propertyScopeWhere`).
 *
 * "Done" needs proof: at least one after-photo on the issue, newer than the
 * last time the repair was sent back, so returned work cannot be resubmitted
 * with the photos that were just rejected.
 */

const CLOSED: IssueStatus[] = [IssueStatus.VERIFIED, IssueStatus.CLOSED];

async function loadIssue(ctx: SessionContext, issueId: string) {
  const issue = await prisma.issue.findFirst({
    where: { AND: [{ id: issueId }, issueScopeWhere(ctx)] },
    include: { property: { select: { id: true, name: true } } },
  });
  if (!issue) throw new ApiError(404, "Issue not found");
  return issue;
}

/** Whether this caller is the one sent to do the repair. */
export function isRepairer(ctx: SessionContext, issue: { vendorId: string | null; assigneeId: string | null }) {
  if (ctx.role === Role.VENDOR) return !!ctx.vendorId && ctx.vendorId === issue.vendorId;
  return !!issue.assigneeId && issue.assigneeId === ctx.userId;
}

function requireRepairer(ctx: SessionContext, issue: { vendorId: string | null; assigneeId: string | null }) {
  if (!isRepairer(ctx, issue)) {
    throw new ApiError(403, "Only the person or company assigned to this repair can do that");
  }
}

/** Tells whoever is doing the repair: the vendor company's people, or the assigned staff member. */
async function notifyRepairer(
  issue: { organizationId: string; vendorId: string | null; assigneeId: string | null; id: string },
  type: NotificationType,
  title: string,
  body?: string,
) {
  const link = `/issues/${issue.id}`;
  if (issue.vendorId) {
    await notifyVendorUsers({ organizationId: issue.organizationId, vendorId: issue.vendorId, type, title, body, link });
  } else if (issue.assigneeId) {
    await notifyUser({ organizationId: issue.organizationId, userId: issue.assigneeId, type, title, body, link });
  }
}

export async function startRepair(ctx: SessionContext, issueId: string) {
  const issue = await loadIssue(ctx, issueId);
  requireRepairer(ctx, issue);
  if (CLOSED.includes(issue.status) || issue.status === IssueStatus.RESOLVED) {
    throw new ApiError(409, "This repair is not open for work");
  }
  if (issue.status === IssueStatus.IN_PROGRESS) return issue;
  return prisma.issue.update({
    where: { id: issue.id },
    data: { status: IssueStatus.IN_PROGRESS, version: { increment: 1 } },
  });
}

export async function submitRepair(
  ctx: SessionContext,
  issueId: string,
  input: { notes: string; actualCost?: number | null },
) {
  const issue = await loadIssue(ctx, issueId);
  requireRepairer(ctx, issue);
  if (CLOSED.includes(issue.status)) throw new ApiError(409, "This repair is already closed");
  if (issue.status === IssueStatus.RESOLVED) throw new ApiError(409, "This repair is already waiting to be checked");

  const notes = input.notes.trim();
  if (!notes) throw new ApiError(400, "Say what you did, so the reviewer knows what they are checking");

  const afterPhotos = await prisma.evidence.count({
    where: {
      issueId: issue.id,
      repairStage: "AFTER",
      ...(issue.repairSentBackAt ? { createdAt: { gt: issue.repairSentBackAt } } : {}),
    },
  });
  if (afterPhotos === 0) {
    throw new ApiError(
      400,
      issue.repairSentBackAt
        ? "Add at least one new after-photo — the repair was sent back, so earlier photos no longer count"
        : "Add at least one after-photo showing the finished repair",
    );
  }

  const updated = await prisma.issue.update({
    where: { id: issue.id },
    data: {
      status: IssueStatus.RESOLVED,
      repairNotes: notes,
      repairSubmittedAt: new Date(),
      repairSubmittedById: ctx.userId,
      ...(input.actualCost !== undefined ? { actualCost: input.actualCost } : {}),
      version: { increment: 1 },
    },
  });

  await writeAuditLog({
    organizationId: issue.organizationId,
    actorUserId: ctx.userId,
    action: "repair.submitted",
    entityType: "Issue",
    entityId: issue.id,
    metadata: { afterPhotos, actualCost: input.actualCost ?? null },
  });
  try {
    await notifyPropertyStakeholders({
      propertyId: issue.propertyId,
      type: "REPAIR_SUBMITTED",
      title: `Repair ready to check: ${issue.title}`,
      body: `${issue.property.name} — ${notes.slice(0, 300)}`,
      link: `/issues/${issue.id}`,
    });
  } catch {
    // A failed notification must not undo a submission already recorded.
  }
  return updated;
}

function requireVerifier(ctx: SessionContext, issue: { repairSubmittedById: string | null; vendorId: string | null; assigneeId: string | null }) {
  if (!hasPermission(ctx.role, "canVerifyRepairs")) {
    throw new ApiError(403, "Only an admin or a manager of this building can check a repair");
  }
  // Checking your own work is not checking it.
  if (issue.repairSubmittedById === ctx.userId || isRepairer(ctx, issue)) {
    throw new ApiError(403, "Someone other than the repairer has to check this repair");
  }
}

export async function verifyRepair(
  ctx: SessionContext,
  issueId: string,
  input: { conditionScore?: number | null; note?: string | null } = {},
) {
  const issue = await loadIssue(ctx, issueId);
  requireVerifier(ctx, issue);
  if (issue.status !== IssueStatus.RESOLVED) throw new ApiError(409, "Only a repair marked done can be verified");

  const now = new Date();
  const updated = await prisma.issue.update({
    where: { id: issue.id },
    data: {
      status: IssueStatus.VERIFIED,
      verifiedAt: now,
      verifiedById: ctx.userId,
      resolvedAt: issue.resolvedAt ?? now,
      resolvedById: issue.resolvedById ?? issue.repairSubmittedById ?? ctx.userId,
      repairSentBackReason: null,
      version: { increment: 1 },
    },
  });

  // The fix changes the asset, so its condition is recorded through the one
  // path that keeps history and recomputes the building's health.
  if (issue.assetId && input.conditionScore !== undefined && input.conditionScore !== null) {
    const latestAfter = await prisma.evidence.findFirst({
      where: { issueId: issue.id, repairStage: "AFTER" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    await recordAssetConditionChange({
      assetId: issue.assetId,
      newScore: input.conditionScore,
      changedByUserId: ctx.userId,
      source: IssueSource.MANUAL,
      reason: `Repaired: ${issue.title}`,
      evidenceId: latestAfter?.id,
      validationStatus: "HUMAN_OBSERVED",
    });
  }
  await recalculatePropertyHealth(issue.propertyId);

  await Promise.all([
    writeAuditLog({
      organizationId: issue.organizationId,
      actorUserId: ctx.userId,
      action: "repair.verified",
      entityType: "Issue",
      entityId: issue.id,
      metadata: { conditionScore: input.conditionScore ?? null, actualCost: issue.actualCost },
    }),
    emitEvent({
      organizationId: issue.organizationId,
      propertyId: issue.propertyId,
      type: EVENT_TYPES.ISSUE_RESOLVED,
      actorUserId: ctx.userId,
      payload: { issueId: issue.id, verified: true },
    }),
  ]);
  try {
    await notifyRepairer(issue, "REPAIR_VERIFIED", `Repair accepted: ${issue.title}`, input.note?.trim() || undefined);
  } catch {
    // As above: the decision is recorded either way.
  }
  return updated;
}

export async function sendBackRepair(ctx: SessionContext, issueId: string, reason: string) {
  const issue = await loadIssue(ctx, issueId);
  requireVerifier(ctx, issue);
  if (issue.status !== IssueStatus.RESOLVED) throw new ApiError(409, "Only a repair marked done can be sent back");
  const why = reason.trim();
  // A send-back with no reason is a repair that comes back unchanged.
  if (!why) throw new ApiError(400, "Say what still needs fixing");

  const updated = await prisma.issue.update({
    where: { id: issue.id },
    data: {
      status: IssueStatus.IN_PROGRESS,
      repairSentBackAt: new Date(),
      repairSentBackReason: why,
      version: { increment: 1 },
    },
  });
  await writeAuditLog({
    organizationId: issue.organizationId,
    actorUserId: ctx.userId,
    action: "repair.sent_back",
    entityType: "Issue",
    entityId: issue.id,
    metadata: { reason: why },
  });
  try {
    await notifyRepairer(issue, "REPAIR_SENT_BACK", `Repair sent back: ${issue.title}`, why);
  } catch {
    // As above.
  }
  return updated;
}
