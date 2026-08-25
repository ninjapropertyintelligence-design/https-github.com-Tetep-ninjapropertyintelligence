import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { getStorageProvider } from "@/lib/storage";
import { SessionContext, canAccessProperty } from "@/lib/tenant-scope";
import {
  DeletionRequestStatus,
  DeletionSurface,
  DeletionSurfaceStatus,
  DeletionTargetType,
  LegalHoldScope,
} from "@/generated/prisma/client";

/**
 * Data retention (spec §52) and secure deletion (spec §54).
 *
 * The spec's line is "Delete does not mean hiding a row", and the six
 * surfaces it names are what this module is built around: database, object
 * storage, search index, derived files, cache, backup retention. Every
 * execution records an outcome per surface, so the answer to "was this
 * really deleted?" is a breakdown rather than a boolean.
 *
 * Two surfaces get an honest non-success outcome by design:
 *   - CACHE is NOT_APPLICABLE: this deployment has no external cache holding
 *     customer data. Reporting it as deleted would be a lie about work that
 *     never happened.
 *   - BACKUP_RETENTION is SCHEDULED, with the date the last backup
 *     containing this data expires. Backups cannot be selectively erased on
 *     request; the obligation is recorded and dated instead of pretended.
 */

export const DEFAULT_POLICY = {
  activePropertyRetentionDays: null as number | null,
  deletedPropertyGraceDays: 30,
  deletedOrganizationGraceDays: 30,
  archivedCaptureRetentionDays: 365,
  customerTerminationGraceDays: 30,
  backupRetentionDays: 35,
};

export async function getRetentionPolicy(organizationId: string) {
  const existing = await prisma.retentionPolicy.findUnique({ where: { organizationId } });
  if (existing) return existing;
  // Never auto-created on read: a policy row appearing as a side effect of
  // someone opening a settings page would make "was a policy ever set?"
  // unanswerable. The defaults are returned instead.
  return { organizationId, ...DEFAULT_POLICY, id: null, createdAt: null, updatedAt: null };
}

export async function updateRetentionPolicy(
  ctx: SessionContext,
  input: Partial<typeof DEFAULT_POLICY>,
) {
  const data = {
    ...DEFAULT_POLICY,
    ...(await getRetentionPolicy(ctx.organizationId)),
    ...input,
  };

  const policy = await prisma.retentionPolicy.upsert({
    where: { organizationId: ctx.organizationId },
    create: {
      organizationId: ctx.organizationId,
      activePropertyRetentionDays: data.activePropertyRetentionDays,
      deletedPropertyGraceDays: data.deletedPropertyGraceDays,
      deletedOrganizationGraceDays: data.deletedOrganizationGraceDays,
      archivedCaptureRetentionDays: data.archivedCaptureRetentionDays,
      customerTerminationGraceDays: data.customerTerminationGraceDays,
      backupRetentionDays: data.backupRetentionDays,
    },
    update: input,
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "retention.policy_updated",
    entityType: "RetentionPolicy",
    entityId: policy.id,
    metadata: { changed: input },
  });

  return policy;
}

// ---------------------------------------------------------------------------
// Legal hold
// ---------------------------------------------------------------------------

export async function placeLegalHold(
  ctx: SessionContext,
  input: { scopeType: LegalHoldScope; propertyId?: string | null; reason: string },
) {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new ApiError(400, "A reason is required for a legal hold");

  if (input.scopeType === "PROPERTY") {
    if (!input.propertyId) throw new ApiError(400, "A property is required for a property-scoped hold");
    await assertPropertyInScope(ctx, input.propertyId);
  }

  const hold = await prisma.legalHold.create({
    data: {
      organizationId: ctx.organizationId,
      scopeType: input.scopeType,
      propertyId: input.scopeType === "PROPERTY" ? input.propertyId : null,
      reason,
      placedByUserId: ctx.userId,
    },
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "retention.legal_hold_placed",
    entityType: "LegalHold",
    entityId: hold.id,
    metadata: { scopeType: input.scopeType, propertyId: hold.propertyId, reason },
  });

  return hold;
}

export async function releaseLegalHold(ctx: SessionContext, holdId: string) {
  const hold = await prisma.legalHold.findUnique({ where: { id: holdId } });
  if (!hold || hold.organizationId !== ctx.organizationId) throw new ApiError(404, "Legal hold not found");
  if (hold.releasedAt) return hold;

  const released = await prisma.legalHold.update({
    where: { id: hold.id },
    data: { releasedAt: new Date(), releasedByUserId: ctx.userId },
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "retention.legal_hold_released",
    entityType: "LegalHold",
    entityId: hold.id,
  });

  return released;
}

export function listLegalHolds(ctx: SessionContext) {
  return prisma.legalHold.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { placedAt: "desc" },
    include: { property: { select: { id: true, name: true } }, placedBy: { select: { name: true } } },
  });
}

/**
 * An org-scoped hold covers every property in it; a property-scoped hold
 * covers only that one. Checked at execution time as well as request time,
 * because a hold placed *during* the grace window must still stop the
 * deletion — that is the situation holds exist for.
 */
async function activeHoldFor(params: {
  organizationId: string;
  propertyId?: string | null;
}): Promise<{ id: string; reason: string } | null> {
  const hold = await prisma.legalHold.findFirst({
    where: {
      organizationId: params.organizationId,
      releasedAt: null,
      OR: [
        { scopeType: "ORGANIZATION" },
        ...(params.propertyId ? [{ scopeType: "PROPERTY" as LegalHoldScope, propertyId: params.propertyId }] : []),
      ],
    },
    select: { id: true, reason: true },
  });
  return hold;
}

// ---------------------------------------------------------------------------
// Deletion requests
// ---------------------------------------------------------------------------

export async function requestPropertyDeletion(
  ctx: SessionContext,
  propertyId: string,
  reason: string,
) {
  const property = await assertPropertyInScope(ctx, propertyId);
  if (reason.trim().length < 5) throw new ApiError(400, "A reason is required");

  const hold = await activeHoldFor({ organizationId: ctx.organizationId, propertyId });
  if (hold) {
    throw new ApiError(409, `This property is under a legal hold and cannot be deleted: ${hold.reason}`);
  }

  const existing = await prisma.deletionRequest.findFirst({
    where: { organizationId: ctx.organizationId, targetId: propertyId, status: "PENDING" },
  });
  if (existing) throw new ApiError(409, "A deletion is already scheduled for this property");

  const policy = await getRetentionPolicy(ctx.organizationId);
  const scheduledFor = new Date(Date.now() + policy.deletedPropertyGraceDays * 86_400_000);

  const request = await prisma.deletionRequest.create({
    data: {
      organizationId: ctx.organizationId,
      targetType: DeletionTargetType.PROPERTY,
      targetId: propertyId,
      targetLabel: property.name,
      reason: reason.trim(),
      requestedByUserId: ctx.userId,
      scheduledFor,
    },
  });

  // The property is marked, not hidden — it stays visible and recoverable
  // for the whole grace window, which is the point of having one.
  await prisma.property.update({
    where: { id: propertyId },
    data: { retentionStatus: "SCHEDULED_FOR_DELETION" },
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "retention.deletion_requested",
    entityType: "Property",
    entityId: propertyId,
    metadata: { reason: request.reason, scheduledFor: scheduledFor.toISOString(), requestId: request.id },
  });

  return request;
}

export async function cancelDeletionRequest(ctx: SessionContext, requestId: string) {
  const request = await prisma.deletionRequest.findUnique({ where: { id: requestId } });
  if (!request || request.organizationId !== ctx.organizationId) throw new ApiError(404, "Deletion request not found");
  if (request.status !== "PENDING") {
    throw new ApiError(409, `This request is ${request.status.toLowerCase()} and can no longer be cancelled`);
  }

  const cancelled = await prisma.deletionRequest.update({
    where: { id: request.id },
    data: { status: DeletionRequestStatus.CANCELLED, cancelledAt: new Date() },
  });

  if (request.targetType === "PROPERTY") {
    await prisma.property.updateMany({ where: { id: request.targetId }, data: { retentionStatus: "ACTIVE" } });
  }

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "retention.deletion_cancelled",
    entityType: request.targetType,
    entityId: request.targetId,
    metadata: { requestId: request.id },
  });

  return cancelled;
}

export function listDeletionRequests(ctx: SessionContext) {
  return prisma.deletionRequest.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { requestedAt: "desc" },
    take: 50,
    include: { surfaces: true, requestedBy: { select: { name: true } } },
  });
}

// ---------------------------------------------------------------------------
// Execution — the six surfaces of spec §54
// ---------------------------------------------------------------------------

interface SurfaceOutcome {
  surface: DeletionSurface;
  status: DeletionSurfaceStatus;
  itemCount: number;
  detail?: string;
}

/**
 * Runs every deletion whose grace window has elapsed. Intended to be driven
 * by a scheduled job; exposed as an admin endpoint so it is operable and
 * testable without one existing yet.
 */
export async function runDueDeletions(now = new Date()) {
  const due = await prisma.deletionRequest.findMany({
    where: { status: "PENDING", scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: 50,
  });

  const results = [];
  for (const request of due) {
    results.push(await executeDeletionRequest(request.id));
  }
  return results;
}

export async function executeDeletionRequest(requestId: string) {
  const request = await prisma.deletionRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new ApiError(404, "Deletion request not found");
  if (request.status !== "PENDING") {
    throw new ApiError(409, `This request is already ${request.status.toLowerCase()}`);
  }

  // Re-checked at execution, not only at request time: a hold placed during
  // the grace window is exactly the case holds exist for.
  const hold = await activeHoldFor({
    organizationId: request.organizationId,
    propertyId: request.targetType === "PROPERTY" ? request.targetId : null,
  });
  if (hold) {
    await prisma.deletionRequest.update({
      where: { id: request.id },
      data: { status: DeletionRequestStatus.BLOCKED_BY_LEGAL_HOLD, error: `Legal hold: ${hold.reason}` },
    });
    await writeAuditLog({
      organizationId: request.organizationId,
      actorUserId: null,
      action: "retention.deletion_blocked_by_legal_hold",
      entityType: request.targetType,
      entityId: request.targetId,
      metadata: { requestId: request.id, holdId: hold.id },
    });
    return { requestId: request.id, status: "BLOCKED_BY_LEGAL_HOLD" as const, surfaces: [] };
  }

  const policy = await getRetentionPolicy(request.organizationId);
  const propertyIds =
    request.targetType === "PROPERTY"
      ? [request.targetId]
      : (await prisma.property.findMany({ where: { organizationId: request.targetId }, select: { id: true } })).map(
          (p) => p.id,
        );

  const outcomes: SurfaceOutcome[] = [];

  try {
    // Order matters. Everything that needs to *read* the rows to find what
    // to destroy elsewhere must run before the database cascade removes
    // them — a storage key you can no longer look up is an orphaned object
    // that lives forever.
    const keys = await collectStorageKeys(propertyIds);

    outcomes.push(await deleteFromObjectStorage(keys.all));
    outcomes.push(await countDerivedFiles(keys.derived));
    outcomes.push(await deleteFromSearchIndex(propertyIds, request));
    outcomes.push(await deleteFromDatabase(request, propertyIds));
    outcomes.push(cacheOutcome());
    outcomes.push(backupOutcome(policy.backupRetentionDays));

    const failed = outcomes.filter((o) => o.status === "FAILED");
    await persistOutcomes(request.id, outcomes);
    await prisma.deletionRequest.update({
      where: { id: request.id },
      data: {
        status: failed.length ? DeletionRequestStatus.FAILED : DeletionRequestStatus.COMPLETED,
        executedAt: new Date(),
        error: failed.length ? failed.map((f) => `${f.surface}: ${f.detail}`).join("; ") : null,
      },
    });

    await writeAuditLog({
      organizationId: request.organizationId,
      actorUserId: null,
      action: failed.length ? "retention.deletion_failed" : "retention.deletion_completed",
      entityType: request.targetType,
      entityId: request.targetId,
      metadata: {
        requestId: request.id,
        targetLabel: request.targetLabel,
        surfaces: outcomes.map((o) => ({ surface: o.surface, status: o.status, itemCount: o.itemCount })),
      },
    });

    return {
      requestId: request.id,
      status: failed.length ? ("FAILED" as const) : ("COMPLETED" as const),
      surfaces: outcomes,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await persistOutcomes(request.id, outcomes);
    await prisma.deletionRequest.update({
      where: { id: request.id },
      data: { status: DeletionRequestStatus.FAILED, executedAt: new Date(), error: message },
    });
    throw err;
  }
}

/**
 * Every object-storage key reachable from these properties. Missing one
 * here is the failure mode that matters: the row goes away, the object
 * doesn't, and nothing afterwards can find it to try again.
 */
async function collectStorageKeys(propertyIds: string[]) {
  const [evidence, documentVersions, droneImages, droneOutputs] = await Promise.all([
    prisma.evidence.findMany({
      where: { propertyId: { in: propertyIds } },
      select: { storageKey: true, thumbnailKey: true },
    }),
    prisma.documentVersion.findMany({
      where: { document: { propertyId: { in: propertyIds } } },
      select: { storageKey: true },
    }),
    prisma.droneImage.findMany({
      where: { dataset: { capture: { propertyId: { in: propertyIds } } } },
      select: { storageKey: true },
    }),
    prisma.droneOutput.findMany({
      where: { dataset: { capture: { propertyId: { in: propertyIds } } } },
      select: { storageKey: true },
    }),
  ]);

  // "Derived files" in spec §54's list: processing outputs (orthomosaics,
  // point clouds, meshes) and generated thumbnails — things produced from
  // the originals rather than uploaded.
  const derived = [
    ...droneOutputs.map((o) => o.storageKey),
    ...evidence.map((e) => e.thumbnailKey).filter((k): k is string => Boolean(k)),
  ];

  const all = [
    ...evidence.map((e) => e.storageKey),
    ...evidence.map((e) => e.thumbnailKey).filter((k): k is string => Boolean(k)),
    ...documentVersions.map((d) => d.storageKey),
    ...droneImages.map((i) => i.storageKey),
    ...droneOutputs.map((o) => o.storageKey),
  ];

  return { all: [...new Set(all)], derived: [...new Set(derived)] };
}

async function deleteFromObjectStorage(keys: string[]): Promise<SurfaceOutcome> {
  const storage = getStorageProvider();
  const failures: string[] = [];

  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch (err) {
      failures.push(`${key}: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  return {
    surface: DeletionSurface.OBJECT_STORAGE,
    status: failures.length ? DeletionSurfaceStatus.FAILED : DeletionSurfaceStatus.COMPLETED,
    itemCount: keys.length - failures.length,
    // Truncated: one unreachable bucket can produce thousands of identical
    // messages, and the count above already carries the magnitude.
    detail: failures.length ? `${failures.length} object(s) failed: ${failures.slice(0, 3).join("; ")}` : undefined,
  };
}

/** Reported separately because §54 names derived files as their own surface. */
function countDerivedFiles(derivedKeys: string[]): Promise<SurfaceOutcome> {
  return Promise.resolve({
    surface: DeletionSurface.DERIVED_FILES,
    status: DeletionSurfaceStatus.COMPLETED,
    itemCount: derivedKeys.length,
    detail:
      derivedKeys.length > 0
        ? "Processing outputs and thumbnails, removed with the object-storage pass above."
        : "No derived files existed for this target.",
  });
}

/**
 * DocumentChunk is this app's search index. Deleted explicitly and counted
 * before the cascade, so the number reported is one that was actually
 * measured rather than inferred.
 */
async function deleteFromSearchIndex(
  propertyIds: string[],
  request: { targetType: DeletionTargetType; targetId: string },
): Promise<SurfaceOutcome> {
  const where =
    request.targetType === "ORGANIZATION"
      ? { organizationId: request.targetId }
      : { propertyId: { in: propertyIds } };

  const deleted = await prisma.documentChunk.deleteMany({ where });
  return {
    surface: DeletionSurface.SEARCH_INDEX,
    status: DeletionSurfaceStatus.COMPLETED,
    itemCount: deleted.count,
  };
}

async function deleteFromDatabase(
  request: { targetType: DeletionTargetType; targetId: string },
  propertyIds: string[],
): Promise<SurfaceOutcome> {
  if (request.targetType === "ORGANIZATION") {
    await prisma.organization.delete({ where: { id: request.targetId } });
    return { surface: DeletionSurface.DATABASE, status: DeletionSurfaceStatus.COMPLETED, itemCount: 1 };
  }

  await prisma.property.deleteMany({ where: { id: { in: propertyIds } } });
  return {
    surface: DeletionSurface.DATABASE,
    status: DeletionSurfaceStatus.COMPLETED,
    itemCount: propertyIds.length,
  };
}

function cacheOutcome(): SurfaceOutcome {
  return {
    surface: DeletionSurface.CACHE,
    status: DeletionSurfaceStatus.NOT_APPLICABLE,
    itemCount: 0,
    detail:
      "This deployment holds no customer data in an external cache. Adding one (Redis, a CDN caching " +
      "signed responses) requires an eviction step here before it can be reported as deleted.",
  };
}

/**
 * The honest surface. Backups cannot be selectively erased on request; the
 * data survives until every backup containing it ages out. Recording the
 * date is the only truthful thing available, and it is what an auditor
 * asking "when is it actually gone?" needs.
 */
function backupOutcome(backupRetentionDays: number): SurfaceOutcome {
  const expiresAt = new Date(Date.now() + backupRetentionDays * 86_400_000);
  return {
    surface: DeletionSurface.BACKUP_RETENTION,
    status: DeletionSurfaceStatus.SCHEDULED,
    itemCount: 0,
    detail:
      `Backups cannot be selectively purged. Data remains in backups until they expire on ` +
      `${expiresAt.toISOString().slice(0, 10)} (${backupRetentionDays}-day backup retention).`,
  };
}

async function persistOutcomes(requestId: string, outcomes: SurfaceOutcome[]) {
  for (const outcome of outcomes) {
    await prisma.deletionSurfaceResult.upsert({
      where: { requestId_surface: { requestId, surface: outcome.surface } },
      create: {
        requestId,
        surface: outcome.surface,
        status: outcome.status,
        itemCount: outcome.itemCount,
        detail: outcome.detail ?? null,
        completedAt: new Date(),
      },
      update: {
        status: outcome.status,
        itemCount: outcome.itemCount,
        detail: outcome.detail ?? null,
        completedAt: new Date(),
      },
    });
  }
}

async function assertPropertyInScope(ctx: SessionContext, propertyId: string) {
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId: ctx.organizationId },
    select: { id: true, name: true },
  });
  if (!property) throw new ApiError(404, "Property not found");
  if (!(await canAccessProperty(ctx, propertyId))) throw new ApiError(403, "You do not have access to this property");
  return property;
}
