import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { logEvent } from "@/lib/observability";
import { getStorageProvider, type StorageTierName } from "@/lib/storage";
import type { SessionContext } from "@/lib/tenant-scope";
import { StorageObjectKind, StorageRestoreState, StorageTier } from "@/generated/prisma/client";

/**
 * STORAGE LIFECYCLE TIERING (spec §51).
 *
 * Capture data is the bulk of what this platform stores and almost all of it
 * goes cold: a drone survey is looked at intensely for a fortnight and then
 * essentially never, while still being the evidence behind a condition score
 * years later. Tiering moves those bytes to cheaper storage classes on age.
 *
 * Two properties this implementation insists on:
 *
 *  1. The ledger records what *happened*, never what was intended. If the
 *     backing store has no storage classes — Supabase Storage and R2 do not —
 *     the run reports NOT_SUPPORTED and the recorded tier does not move. A
 *     cost report built on intentions would be fiction.
 *
 *  2. Tiering is opt-in per organization, because it changes read semantics.
 *     A DEEP_ARCHIVE object is not readable until restored, and restore is
 *     asynchronous. That is a real trade the customer should make knowingly
 *     rather than discover when an auditor asks for a five-year-old photo.
 */

export const DEFAULT_TIERING_POLICY = {
  enabled: false,
  infrequentAccessAfterDays: 90 as number | null,
  archiveAfterDays: 365 as number | null,
  deepArchiveAfterDays: null as number | null,
};

/** Cheapest-last ordering. Used to decide whether a move is a demotion. */
const TIER_RANK: Record<StorageTier, number> = {
  STANDARD: 0,
  INFREQUENT_ACCESS: 1,
  ARCHIVE: 2,
  DEEP_ARCHIVE: 3,
};

/** Only DEEP_ARCHIVE requires an explicit restore before the bytes are readable. */
export function tierRequiresRestore(tier: StorageTier): boolean {
  return tier === StorageTier.DEEP_ARCHIVE;
}

export async function getTieringPolicy(organizationId: string) {
  const existing = await prisma.storageTieringPolicy.findUnique({ where: { organizationId } });
  return existing ?? { organizationId, ...DEFAULT_TIERING_POLICY };
}

export async function updateTieringPolicy(
  ctx: SessionContext,
  input: {
    enabled?: boolean;
    infrequentAccessAfterDays?: number | null;
    archiveAfterDays?: number | null;
    deepArchiveAfterDays?: number | null;
  },
) {
  const next = {
    enabled: input.enabled ?? DEFAULT_TIERING_POLICY.enabled,
    infrequentAccessAfterDays: input.infrequentAccessAfterDays ?? null,
    archiveAfterDays: input.archiveAfterDays ?? null,
    deepArchiveAfterDays: input.deepArchiveAfterDays ?? null,
  };

  /**
   * Thresholds must increase with coldness. Without this, a policy of
   * "archive at 30 days, infrequent access at 90" would have objects
   * qualifying for a colder tier before a warmer one and thrash between
   * them on every run — each transition being a billable copy.
   */
  const ordered: [string, number | null][] = [
    ["infrequent access", next.infrequentAccessAfterDays],
    ["archive", next.archiveAfterDays],
    ["deep archive", next.deepArchiveAfterDays],
  ];
  let previousLabel: string | null = null;
  let previousValue: number | null = null;
  for (const [label, value] of ordered) {
    if (value === null) continue;
    if (value < 0) {
      throw new ApiError(422, `The ${label} threshold cannot be negative`);
    }
    if (previousValue !== null && value <= previousValue) {
      throw new ApiError(
        422,
        `The ${label} threshold (${value} days) must be greater than the ${previousLabel} threshold (${previousValue} days) — colder tiers must come later, or objects would thrash between them`,
      );
    }
    previousLabel = label;
    previousValue = value;
  }

  const saved = await prisma.storageTieringPolicy.upsert({
    where: { organizationId: ctx.organizationId },
    create: { organizationId: ctx.organizationId, ...next },
    update: next,
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "storage_tiering_policy.updated",
    entityType: "StorageTieringPolicy",
    entityId: saved.id,
    metadata: next,
  });
  return saved;
}

/**
 * Records an object in the tier ledger. Idempotent on (organizationId, key)
 * so re-registering an existing object is harmless — callers run at upload
 * time and during backfill, and those overlap.
 */
export async function registerStorageObject(params: {
  organizationId: string;
  storageKey: string;
  kind: StorageObjectKind;
  sizeBytes?: number | null;
  objectCreatedAt: Date;
}) {
  return prisma.storageObject.upsert({
    where: {
      organizationId_storageKey: {
        organizationId: params.organizationId,
        storageKey: params.storageKey,
      },
    },
    create: {
      organizationId: params.organizationId,
      storageKey: params.storageKey,
      kind: params.kind,
      sizeBytes: params.sizeBytes ?? null,
      objectCreatedAt: params.objectCreatedAt,
    },
    // Size can arrive after the row does (verification follows upload), but
    // the tier is owned by the runner and must never be reset by a re-register.
    update: { sizeBytes: params.sizeBytes ?? undefined },
  });
}

/**
 * The coldest tier an object of this age qualifies for, or null if it should
 * stay where it is. Pure and exported so the thresholds can be tested without
 * a database or a storage backend.
 */
export function targetTierFor(
  ageDays: number,
  policy: {
    infrequentAccessAfterDays: number | null;
    archiveAfterDays: number | null;
    deepArchiveAfterDays: number | null;
  },
): StorageTier | null {
  if (policy.deepArchiveAfterDays !== null && ageDays >= policy.deepArchiveAfterDays) {
    return StorageTier.DEEP_ARCHIVE;
  }
  if (policy.archiveAfterDays !== null && ageDays >= policy.archiveAfterDays) {
    return StorageTier.ARCHIVE;
  }
  if (policy.infrequentAccessAfterDays !== null && ageDays >= policy.infrequentAccessAfterDays) {
    return StorageTier.INFREQUENT_ACCESS;
  }
  return null;
}

const TIER_TO_PROVIDER: Record<StorageTier, StorageTierName> = {
  STANDARD: "STANDARD",
  INFREQUENT_ACCESS: "INFREQUENT_ACCESS",
  ARCHIVE: "ARCHIVE",
  DEEP_ARCHIVE: "DEEP_ARCHIVE",
};

export interface TieringRunSummary {
  organizationId: string;
  scanned: number;
  transitioned: number;
  skipped: number;
  failed: number;
  /** Set when the backing store has no storage classes; nothing was moved. */
  notSupportedReason: string | null;
}

/**
 * Applies the org's policy to its ledger.
 *
 * Deliberately not wrapped in a transaction. Each transition is an
 * irreversible, billable call to an external store, and a rollback could not
 * un-move the bytes — it would only lose the record that they moved, leaving
 * the ledger claiming STANDARD for an object sitting in Glacier. Each row is
 * therefore committed immediately after its own transition succeeds.
 */
export async function runTieringForOrganization(
  organizationId: string,
  now = new Date(),
): Promise<TieringRunSummary> {
  const summary: TieringRunSummary = {
    organizationId,
    scanned: 0,
    transitioned: 0,
    skipped: 0,
    failed: 0,
    notSupportedReason: null,
  };

  const policy = await getTieringPolicy(organizationId);
  if (!policy.enabled) {
    summary.notSupportedReason = "Tiering is not enabled for this organization";
    return summary;
  }

  const provider = getStorageProvider();
  if (!provider.capabilities().tiering) {
    // Ask once rather than per object, and report it as the single fact it is.
    const probe = await provider.transitionTier("", "INFREQUENT_ACCESS");
    summary.notSupportedReason =
      probe.status === "NOT_SUPPORTED" ? probe.reason : "This storage backend does not support tiering";
    return summary;
  }

  const candidates = await prisma.storageObject.findMany({
    where: { organizationId },
    orderBy: { objectCreatedAt: "asc" },
  });

  for (const object of candidates) {
    summary.scanned += 1;
    const ageDays = Math.floor((now.getTime() - object.objectCreatedAt.getTime()) / 86_400_000);
    const target = targetTierFor(ageDays, policy);

    // Nothing due, or the object is already at least this cold. Tiering only
    // ever moves in the colder direction here — warming back up is what the
    // restore path is for, and doing it implicitly would silently multiply
    // a customer's storage bill.
    if (target === null || TIER_RANK[target] <= TIER_RANK[object.currentTier]) {
      summary.skipped += 1;
      continue;
    }

    const result = await provider.transitionTier(object.storageKey, TIER_TO_PROVIDER[target]);
    if (result.status === "TRANSITIONED") {
      await prisma.storageObject.update({
        where: { id: object.id },
        data: {
          currentTier: target,
          lastTransitionedAt: now,
          // Moving to a colder tier invalidates any prior restore.
          restoreState: StorageRestoreState.NOT_REQUESTED,
          restoreRequestedAt: null,
          restoreExpiresAt: null,
        },
      });
      summary.transitioned += 1;
    } else if (result.status === "NOT_SUPPORTED") {
      // Capability changed underneath us mid-run. Stop rather than log one
      // failure per object for a condition that applies to all of them.
      summary.notSupportedReason = result.reason;
      break;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}

/** Runs every organization that has tiering switched on. */
export async function runDueTiering(now = new Date()): Promise<TieringRunSummary[]> {
  const policies = await prisma.storageTieringPolicy.findMany({ where: { enabled: true } });
  const summaries: TieringRunSummary[] = [];
  for (const policy of policies) {
    summaries.push(await runTieringForOrganization(policy.organizationId, now));
  }
  return summaries;
}

/**
 * Asks the store to make an archived object readable again.
 *
 * Returns the ledger row so the caller can show the customer the real state.
 * A restore that is merely in progress is reported as in progress — the one
 * thing this must not do is imply the bytes are ready when they are not.
 */
export async function requestRestore(
  ctx: SessionContext,
  storageKey: string,
  availableForDays = 7,
) {
  const object = await prisma.storageObject.findUnique({
    where: { organizationId_storageKey: { organizationId: ctx.organizationId, storageKey } },
  });
  if (!object) {
    throw new ApiError(404, "No stored object with that key belongs to this organization");
  }
  if (!tierRequiresRestore(object.currentTier)) {
    return { object, outcome: { status: "ALREADY_AVAILABLE" as const } };
  }

  const outcome = await getStorageProvider().restoreObject(storageKey, availableForDays);
  const now = new Date();
  const data =
    outcome.status === "REQUESTED"
      ? {
          restoreState: StorageRestoreState.IN_PROGRESS,
          restoreRequestedAt: now,
          restoreExpiresAt: outcome.availableAfter,
        }
      : outcome.status === "ALREADY_AVAILABLE"
        ? { restoreState: StorageRestoreState.AVAILABLE, restoreRequestedAt: now }
        : { restoreState: StorageRestoreState.FAILED, restoreRequestedAt: now };

  const updated = await prisma.storageObject.update({ where: { id: object.id }, data });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "storage_object.restore_requested",
    entityType: "StorageObject",
    entityId: object.id,
    metadata: { storageKey, outcome: outcome.status },
  });
  return { object: updated, outcome };
}

/**
 * Bytes and object counts per tier. This is the input §49/§50 needs to turn
 * storage into a cost figure, which is why it sums the ledger rather than the
 * four owning tables.
 */
export async function summarizeStorageByTier(organizationId: string) {
  const grouped = await prisma.storageObject.groupBy({
    by: ["currentTier"],
    where: { organizationId },
    _sum: { sizeBytes: true },
    _count: { _all: true },
  });
  const byTier: Record<string, { objects: number; bytes: number }> = {};
  for (const tier of Object.keys(TIER_RANK)) {
    byTier[tier] = { objects: 0, bytes: 0 };
  }
  for (const row of grouped) {
    // Prisma returns a BigInt sum for a BigInt column; Number is exact to
    // 2^53 bytes (~9 PB), far past any figure this will ever hold.
    byTier[row.currentTier] = { objects: row._count._all, bytes: Number(row._sum.sizeBytes ?? 0) };
  }
  // Totals are returned rather than left to the caller so every consumer —
  // the settings screen and the cost report (§49/§50) — agrees on them.
  const totals = Object.values(byTier).reduce(
    (acc, t) => ({ objects: acc.objects + t.objects, bytes: acc.bytes + t.bytes }),
    { objects: 0, bytes: 0 },
  );
  return { byTier, totalObjects: totals.objects, totalBytes: totals.bytes };
}

/**
 * Register an object in the tiering ledger without letting a ledger failure
 * fail the upload that produced it.
 *
 * By the time this is called the bytes are in the store and the domain row
 * (DroneImage, DocumentVersion, Evidence...) is written. The ledger exists so
 * the object can later be moved to a cheaper storage class; losing an entry
 * costs money, it does not lose data or corrupt anything. Rejecting a
 * successful upload over that trade would be the worse failure.
 *
 * It is not silent, though: a missing entry means an object that is never
 * tiered and quietly bills at STANDARD forever, so each failure is logged for
 * a reconciliation pass to pick up.
 */
export async function registerStorageObjectBestEffort(params: {
  organizationId: string;
  storageKey: string;
  kind: StorageObjectKind;
  sizeBytes?: number | null;
  objectCreatedAt: Date;
}) {
  try {
    await registerStorageObject(params);
  } catch (error) {
    logEvent("storage.register_failed", {
      ok: false,
      organizationId: params.organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
