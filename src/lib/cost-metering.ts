import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { logEvent } from "@/lib/observability";
import type { SessionContext } from "@/lib/tenant-scope";
import { StorageTier, UsageMetricType } from "@/generated/prisma/client";

/**
 * COST METERING AND PROPERTY-LEVEL COGS (spec §49/§50).
 *
 * Three distinctions carry this file, and collapsing any of them produces a
 * number that looks authoritative and is wrong:
 *
 * 1. EVENTS vs LEVELS. An AI call costs money once, when it happens. A stored
 *    gigabyte costs money continuously for as long as it sits there. Summing
 *    storage the way you sum AI calls is meaningless — you would be adding up
 *    the same gigabyte over and over, or counting it once and calling a
 *    year's rent a one-off. Storage is therefore *sampled* into GB-months by
 *    a periodic job (`sampleStorageUsage`), never recorded at upload time.
 *
 * 2. ATTRIBUTED vs UNATTRIBUTED. Some consumption belongs to a property (a
 *    photogrammetry job for a capture on that property). Some genuinely does
 *    not (an org-wide AI question, platform overhead). Spreading the second
 *    kind evenly across properties would manufacture precision that was never
 *    measured, so `summarizePropertyCogs` reports it as its own line and
 *    leaves the allocation decision to a human who knows what it means.
 *
 * 3. METERED vs UNPRICED. Recording consumption and knowing its cost are
 *    different things. If no rate is configured for a metric, the usage is
 *    still reported — with its cost marked unpriced — rather than priced at
 *    zero. Zero reads as "this was free", which is the one thing it is not.
 */

/** Micros = millionths of a currency unit. See the CostRate model comment. */
const MICROS_PER_UNIT = 1_000_000;

/** Storage tier -> the metric that prices it. */
const TIER_METRIC: Record<StorageTier, UsageMetricType> = {
  [StorageTier.STANDARD]: UsageMetricType.STORAGE_STANDARD_GB_MONTH,
  [StorageTier.INFREQUENT_ACCESS]: UsageMetricType.STORAGE_IA_GB_MONTH,
  [StorageTier.ARCHIVE]: UsageMetricType.STORAGE_ARCHIVE_GB_MONTH,
  [StorageTier.DEEP_ARCHIVE]: UsageMetricType.STORAGE_DEEP_ARCHIVE_GB_MONTH,
};

const BYTES_PER_GB = 1_000_000_000;
/**
 * The denominator for turning "GB held for one sample interval" into
 * GB-months. 30 days, matching how object stores quote per-GB-month pricing.
 */
const DAYS_PER_MONTH = 30;

export interface RecordUsageParams {
  organizationId: string;
  /** Null when the consumption belongs to no single property. See note 2. */
  propertyId?: string | null;
  metricType: UsageMetricType;
  quantity: number;
  source?: string;
  metadata?: Record<string, unknown>;
  recordedAt?: Date;
}

/**
 * Record one metered unit of consumption.
 *
 * Never throws into the caller's path: metering is an accounting side effect
 * of work that has already happened, and failing a customer's AI question
 * because a usage row would not insert would be an absurd trade. A dropped
 * row understates cost, which is logged so it can be reconciled.
 */
export async function recordUsage(params: RecordUsageParams): Promise<void> {
  // A negative quantity would silently offset real consumption elsewhere in
  // the same period, so it is refused rather than stored.
  if (!Number.isFinite(params.quantity) || params.quantity < 0) {
    logEvent("usage.record_failed", {
      ok: false,
      organizationId: params.organizationId,
      errorMessage: `Refusing to record a non-finite or negative quantity (${params.quantity}) for ${params.metricType}`,
    });
    return;
  }
  if (params.quantity === 0) return; // Nothing consumed, nothing to record.

  try {
    await prisma.usageRecord.create({
      data: {
        organizationId: params.organizationId,
        propertyId: params.propertyId ?? null,
        metricType: params.metricType,
        quantity: params.quantity,
        source: params.source ?? null,
        recordedAt: params.recordedAt ?? new Date(),
        metadata: (params.metadata ?? {}) as never,
      },
    });
  } catch (error) {
    logEvent("usage.record_failed", {
      ok: false,
      organizationId: params.organizationId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The rate in effect for a metric at a given instant.
 *
 * An organization-specific rate beats the platform default. Among rates of
 * equal specificity the latest `effectiveFrom` that has already started wins,
 * so a correction inserted later supersedes what it corrects without anyone
 * having to delete history.
 */
export async function resolveRate(
  organizationId: string,
  metricType: UsageMetricType,
  at: Date,
): Promise<{ unitCostMicros: number; currency: string } | null> {
  const candidates = await prisma.costRate.findMany({
    where: {
      metricType,
      effectiveFrom: { lte: at },
      // Two independent OR groups, so they must be AND-ed explicitly rather
      // than both living at the top level where the second would win.
      AND: [
        { OR: [{ organizationId }, { organizationId: null }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
      ],
    },
    orderBy: [{ effectiveFrom: "desc" }],
  });
  if (candidates.length === 0) return null;
  const orgSpecific = candidates.filter((r) => r.organizationId === organizationId);
  const chosen = (orgSpecific.length > 0 ? orgSpecific : candidates)[0];
  return { unitCostMicros: chosen.unitCostMicros, currency: chosen.currency };
}

export interface SetRateParams {
  organizationId: string | null;
  metricType: UsageMetricType;
  unitCostMicros: number;
  currency?: string;
  effectiveFrom: Date;
  note?: string;
}

/**
 * Add a rate version. Existing rows are never edited — see the CostRate model
 * comment — so a mistake is corrected by superseding it, and last month's
 * report keeps pricing last month's usage at the rate that applied then.
 */
export async function setRate(ctx: SessionContext, params: SetRateParams) {
  if (!Number.isInteger(params.unitCostMicros) || params.unitCostMicros < 0) {
    throw new ApiError(422, "Unit cost must be a whole, non-negative number of micros");
  }
  const rate = await prisma.costRate.create({
    data: {
      organizationId: params.organizationId,
      metricType: params.metricType,
      unitCostMicros: params.unitCostMicros,
      currency: params.currency ?? "USD",
      effectiveFrom: params.effectiveFrom,
      note: params.note ?? null,
    },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "cost.rate_set",
    entityType: "CostRate",
    entityId: rate.id,
    metadata: {
      metricType: params.metricType,
      unitCostMicros: params.unitCostMicros,
      scope: params.organizationId === null ? "platform" : "organization",
    },
  });
  return rate;
}

/**
 * Take a point-in-time sample of stored bytes and accrue the GB-months that
 * have elapsed since the previous sample.
 *
 * `intervalDays` is what the caller is asserting this sample covers — i.e.
 * how long it has been since the last run. Passing the wrong value scales the
 * whole storage line linearly, so it is explicit rather than inferred from a
 * schedule this function cannot see.
 */
export async function sampleStorageUsage(
  organizationId: string,
  intervalDays: number,
  now = new Date(),
): Promise<{ sampled: number }> {
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) {
    throw new ApiError(422, "Sample interval must be a positive number of days");
  }

  const grouped = await prisma.storageObject.groupBy({
    by: ["currentTier"],
    where: { organizationId },
    _sum: { sizeBytes: true },
  });

  let sampled = 0;
  for (const row of grouped) {
    const bytes = Number(row._sum.sizeBytes ?? 0);
    if (bytes <= 0) continue;
    const gbMonths = (bytes / BYTES_PER_GB) * (intervalDays / DAYS_PER_MONTH);
    await recordUsage({
      organizationId,
      propertyId: null,
      metricType: TIER_METRIC[row.currentTier],
      quantity: gbMonths,
      source: "storage-sampler",
      metadata: { bytes, intervalDays, tier: row.currentTier },
      recordedAt: now,
    });
    sampled += 1;
  }
  return { sampled };
}

export interface CostLine {
  metricType: UsageMetricType;
  quantity: number;
  /** Null when no rate covers this metric — unpriced, NOT free. See note 3. */
  costMicros: number | null;
  /** True when at least one record in this line had no applicable rate. */
  unpriced: boolean;
}

export interface PropertyCogs {
  propertyId: string;
  propertyName: string;
  lines: CostLine[];
  costMicros: number;
  hasUnpricedUsage: boolean;
}

export interface CogsReport {
  organizationId: string;
  periodStart: Date;
  periodEnd: Date;
  currency: string;
  properties: PropertyCogs[];
  /**
   * Consumption that belongs to the organization but to no single property.
   * Reported separately and never spread across properties — see note 2.
   */
  unattributed: { lines: CostLine[]; costMicros: number; hasUnpricedUsage: boolean };
  totalCostMicros: number;
  /**
   * True when any usage in the period had no applicable rate. A consumer that
   * shows a total without surfacing this is presenting a floor as a total.
   */
  hasUnpricedUsage: boolean;
}

/**
 * Price a set of usage rows, grouping by metric.
 *
 * Each row is priced at the rate in effect at its own `recordedAt`, not at
 * today's rate: a period that straddles a price change must be priced on both
 * sides of it.
 */
async function priceRows(
  organizationId: string,
  rows: Array<{ metricType: UsageMetricType; quantity: number; recordedAt: Date }>,
): Promise<{ lines: CostLine[]; costMicros: number; hasUnpricedUsage: boolean }> {
  const byMetric = new Map<UsageMetricType, CostLine>();

  for (const row of rows) {
    const rate = await resolveRate(organizationId, row.metricType, row.recordedAt);
    const line =
      byMetric.get(row.metricType) ??
      { metricType: row.metricType, quantity: 0, costMicros: 0, unpriced: false };

    line.quantity += row.quantity;
    if (rate === null) {
      line.unpriced = true;
    } else {
      line.costMicros = (line.costMicros ?? 0) + row.quantity * rate.unitCostMicros;
    }
    byMetric.set(row.metricType, line);
  }

  const lines = [...byMetric.values()].map((line) => ({
    ...line,
    // A line with no priced rows at all has no cost — not a cost of zero.
    costMicros: line.unpriced && line.costMicros === 0 ? null : line.costMicros,
  }));

  return {
    lines,
    costMicros: lines.reduce((sum, l) => sum + (l.costMicros ?? 0), 0),
    hasUnpricedUsage: lines.some((l) => l.unpriced),
  };
}

/**
 * Cost of serving each property over a period (spec §50).
 *
 * Reads every usage row in the window once and prices it, rather than issuing
 * a query per property: the report is a cost control, and one that costs a
 * query per property to produce gets turned off at exactly the portfolio size
 * where it starts to matter.
 */
export async function summarizePropertyCogs(
  organizationId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<CogsReport> {
  if (periodEnd <= periodStart) {
    throw new ApiError(422, "Report period must end after it starts");
  }

  const rows = await prisma.usageRecord.findMany({
    where: { organizationId, recordedAt: { gte: periodStart, lt: periodEnd } },
    select: { propertyId: true, metricType: true, quantity: true, recordedAt: true },
  });

  const byProperty = new Map<string, typeof rows>();
  const orphan: typeof rows = [];
  for (const row of rows) {
    if (row.propertyId === null) {
      orphan.push(row);
      continue;
    }
    const existing = byProperty.get(row.propertyId);
    if (existing) existing.push(row);
    else byProperty.set(row.propertyId, [row]);
  }

  const names = new Map(
    (
      await prisma.property.findMany({
        where: { id: { in: [...byProperty.keys()] } },
        select: { id: true, name: true },
      })
    ).map((p) => [p.id, p.name]),
  );

  const properties: PropertyCogs[] = [];
  for (const [propertyId, propertyRows] of byProperty) {
    const priced = await priceRows(organizationId, propertyRows);
    properties.push({
      propertyId,
      // A property deleted since the usage was recorded still has costs that
      // were really incurred; dropping the row would quietly shrink the total.
      propertyName: names.get(propertyId) ?? "(deleted property)",
      lines: priced.lines,
      costMicros: priced.costMicros,
      hasUnpricedUsage: priced.hasUnpricedUsage,
    });
  }
  properties.sort((a, b) => b.costMicros - a.costMicros);

  const unattributed = await priceRows(organizationId, orphan);
  const currency =
    (await prisma.costRate.findFirst({
      where: { OR: [{ organizationId }, { organizationId: null }] },
      orderBy: { effectiveFrom: "desc" },
      select: { currency: true },
    }))?.currency ?? "USD";

  return {
    organizationId,
    periodStart,
    periodEnd,
    currency,
    properties,
    unattributed,
    totalCostMicros:
      properties.reduce((sum, p) => sum + p.costMicros, 0) + unattributed.costMicros,
    hasUnpricedUsage:
      properties.some((p) => p.hasUnpricedUsage) || unattributed.hasUnpricedUsage,
  };
}

/** Micros -> a currency amount, for display only. */
export function microsToCurrency(micros: number): number {
  return micros / MICROS_PER_UNIT;
}
