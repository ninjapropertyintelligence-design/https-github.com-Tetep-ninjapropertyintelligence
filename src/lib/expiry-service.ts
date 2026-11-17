import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { sendEmail } from "@/lib/email";
import { contractorExpiryEmail } from "@/lib/email-templates";
import { notifyPropertyStakeholders } from "@/lib/notifications";
import { logEvent } from "@/lib/observability";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { ExpiryStatus, Role, type Prisma } from "@/generated/prisma/client";
import {
  REMINDER_HORIZON_DAYS,
  calendarDay,
  countdownLabel,
  daysUntil,
  isoDay,
  nextReminder,
  parseCalendarDate,
  urgencyFor,
} from "@/lib/expiry-rules";

/**
 * Expiry tracking: the things at a store that run out, counted down daily,
 * with the people responsible told as each one nears.
 *
 * A record is a store's, and optionally a piece of equipment's. It is entered
 * by hand or read from a photo of the tag (see `ai/expiry-reader.ts`); either
 * way it counts down the same.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const calendarDate = z
  .string()
  .refine((v) => parseCalendarDate(v) !== null, "Use a date like 2026-12-14")
  .transform((v) => parseCalendarDate(v) as Date);

const optionalCalendarDate = z
  .string()
  .nullish()
  .refine((v) => !v || parseCalendarDate(v) !== null, "Use a date like 2026-12-14")
  .transform((v) => (v ? (parseCalendarDate(v) as Date) : null));

export const createExpirySchema = z
  .object({
    propertyId: z.string().min(1).nullish(),
    assetId: z.string().min(1).nullish(),
    kind: z.string().trim().min(1, "Say what expires").max(200),
    label: optionalText(200),
    expiresAt: calendarDate,
    lastInspectedAt: optionalCalendarDate,
    servicedBy: optionalText(200),
    notes: optionalText(2000),
    notifyContractor: z.boolean().default(false),
    /** A photo of the tag, kept as proof when the date was typed. */
    evidenceId: z.string().min(1).nullish(),
  })
  .refine((v) => v.propertyId || v.assetId, { message: "Choose a store or a piece of equipment" });

const updateExpirySchema = z.object({
  kind: z.string().trim().min(1).max(200).optional(),
  label: optionalText(200).optional(),
  expiresAt: calendarDate.optional(),
  lastInspectedAt: optionalCalendarDate.optional(),
  servicedBy: optionalText(200).optional(),
  notes: optionalText(2000).optional(),
  notifyContractor: z.boolean().optional(),
  /** A person has looked at a date a model read, and it is right. */
  confirmed: z.boolean().optional(),
});

const renewExpirySchema = z.object({
  expiresAt: calendarDate,
  lastInspectedAt: optionalCalendarDate,
  evidenceId: z.string().min(1).nullish(),
});

/* ------------------------------------------------------------------ access */

function requireReader(ctx: SessionContext) {
  if (!hasPermission(ctx.role, "canManageAssets") && !hasPermission(ctx.role, "canViewPortfolio")) {
    throw new ApiError(403, "You don't have access to expirations");
  }
}

function requireManager(ctx: SessionContext) {
  if (!hasPermission(ctx.role, "canManageAssets")) throw new ApiError(403, "Missing permission: canManageAssets");
}

/**
 * Who may add a record from a photo: managers, and inspectors and technicians
 * who are out photographing tags. A contractor's own login is not for this.
 */
export function assertMayRecord(ctx: SessionContext) {
  const may =
    hasPermission(ctx.role, "canManageAssets") || (hasPermission(ctx.role, "canUploadEvidence") && ctx.role !== Role.VENDOR);
  if (!may) throw new ApiError(403, "You don't have permission to record expirations");
}

/* -------------------------------------------------------------- shapes */

const contactSelect = { id: true, name: true, trade: true, contactName: true, contactEmail: true, contactPhone: true, emergencyPhone: true } as const;

const itemInclude = {
  property: { select: { id: true, name: true } },
  asset: { select: { id: true, name: true, assetType: true, serviceVendor: { select: contactSelect } } },
} satisfies Prisma.ExpiryItemInclude;

type ItemRow = Prisma.ExpiryItemGetPayload<{ include: typeof itemInclude }>;

export type ExpiryView = ItemRow & { daysLeft: number; urgency: ReturnType<typeof urgencyFor>; countdown: string };

function withCountdown(item: ItemRow, today: Date): ExpiryView {
  const daysLeft = daysUntil(item.expiresAt, today);
  return { ...item, daysLeft, urgency: urgencyFor(daysLeft), countdown: countdownLabel(daysLeft) };
}

function scopeWhere(ctx: SessionContext): Prisma.ExpiryItemWhereInput {
  return { organizationId: ctx.organizationId, property: propertyScopeWhere(ctx) };
}

async function loadItem(ctx: SessionContext, id: string) {
  const item = await prisma.expiryItem.findFirst({ where: { id, ...scopeWhere(ctx) }, include: itemInclude });
  if (!item) throw new ApiError(404, "Expiration not found");
  return item;
}

/** An asset this session can see, with the property it is on. */
export async function loadScopedAsset(ctx: SessionContext, assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { AND: [{ id: assetId }, { organizationId: ctx.organizationId }, { property: propertyScopeWhere(ctx) }] },
    select: { id: true, name: true, assetType: true, propertyId: true },
  });
  if (!asset) throw new ApiError(404, "Asset not found");
  return asset;
}

async function resolveTarget(ctx: SessionContext, input: { propertyId?: string | null; assetId?: string | null }) {
  if (input.assetId) {
    const asset = await loadScopedAsset(ctx, input.assetId);
    if (input.propertyId && input.propertyId !== asset.propertyId) {
      throw new ApiError(400, "That equipment is not at that store");
    }
    return { propertyId: asset.propertyId, assetId: asset.id };
  }
  const property = await prisma.property.findFirst({
    where: { AND: [{ id: input.propertyId as string }, { organizationId: ctx.organizationId }, propertyScopeWhere(ctx)] },
    select: { id: true },
  });
  if (!property) throw new ApiError(404, "Property not found");
  return { propertyId: property.id, assetId: null };
}

/* -------------------------------------------------------------- reading */

export async function listExpiries(
  ctx: SessionContext,
  opts: { propertyId?: string; assetId?: string; status?: ExpiryStatus | "ALL"; withinDays?: number; now?: Date } = {},
): Promise<ExpiryView[]> {
  requireReader(ctx);
  const today = calendarDay(opts.now ?? new Date());
  const where: Prisma.ExpiryItemWhereInput = { ...scopeWhere(ctx) };
  if (opts.propertyId) where.propertyId = opts.propertyId;
  if (opts.assetId) where.assetId = opts.assetId;
  const status = opts.status ?? ExpiryStatus.ACTIVE;
  if (status !== "ALL") where.status = status;
  if (opts.withinDays !== undefined) {
    where.expiresAt = { lte: new Date(today.getTime() + opts.withinDays * 86_400_000) };
  }
  const items = await prisma.expiryItem.findMany({
    where,
    include: itemInclude,
    orderBy: [{ expiresAt: "asc" }, { kind: "asc" }],
    take: 500,
  });
  return items.map((i) => withCountdown(i, today));
}

export async function getExpiry(ctx: SessionContext, id: string) {
  requireReader(ctx);
  return withCountdown(await loadItem(ctx, id), calendarDay(new Date()));
}

/* ------------------------------------------------------------- writing */

export async function createExpiry(ctx: SessionContext, input: unknown) {
  requireManager(ctx);
  const data = createExpirySchema.parse(input);
  const target = await resolveTarget(ctx, data);
  if (data.evidenceId) {
    const photo = await prisma.evidence.findFirst({
      where: { id: data.evidenceId, organizationId: ctx.organizationId, propertyId: target.propertyId },
      select: { id: true },
    });
    if (!photo) throw new ApiError(400, "That photo is not at this store");
  }
  const item = await prisma.expiryItem.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: target.propertyId,
      assetId: target.assetId,
      kind: data.kind,
      label: data.label,
      expiresAt: data.expiresAt,
      lastInspectedAt: data.lastInspectedAt,
      servicedBy: data.servicedBy,
      notes: data.notes,
      notifyContractor: data.notifyContractor,
      evidenceId: data.evidenceId ?? null,
      createdById: ctx.userId,
    },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "expiry.created",
    entityType: "ExpiryItem",
    entityId: item.id,
    metadata: { kind: item.kind, expiresAt: isoDay(item.expiresAt) },
  });
  return item;
}

export async function updateExpiry(ctx: SessionContext, id: string, input: unknown) {
  requireManager(ctx);
  const existing = await loadItem(ctx, id);
  if (existing.status !== ExpiryStatus.ACTIVE) throw new ApiError(409, "This one is no longer active");
  const patch = updateExpirySchema.parse(input);
  const { confirmed, ...fields } = patch;

  const dateChanged = fields.expiresAt !== undefined && isoDay(fields.expiresAt) !== isoDay(existing.expiresAt);
  const updated = await prisma.expiryItem.update({
    where: { id: existing.id },
    data: {
      ...fields,
      // A person setting the date, or saying a read date is right, is the
      // check a model's reading was waiting for.
      ...(dateChanged || confirmed ? { needsReview: false } : {}),
      // A new date is a new countdown: nothing sent for the old one counts.
      ...(dateChanged ? { lastReminderDays: null, lastOverdueNoticeAt: null } : {}),
    },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "expiry.updated",
    entityType: "ExpiryItem",
    entityId: existing.id,
    metadata: { fields: Object.keys(patch), ...(dateChanged ? { from: isoDay(existing.expiresAt), to: isoDay(updated.expiresAt) } : {}) },
  });
  return updated;
}

/**
 * Renews: the old record is kept, marked renewed, and a new one starts its
 * own countdown. The history of when a tag was last replaced is worth more
 * than a date quietly overwritten.
 */
export async function renewExpiry(ctx: SessionContext, id: string, input: unknown) {
  requireManager(ctx);
  const existing = await loadItem(ctx, id);
  if (existing.status !== ExpiryStatus.ACTIVE) throw new ApiError(409, "This one is no longer active");
  const data = renewExpirySchema.parse(input);
  if (data.expiresAt.getTime() <= existing.expiresAt.getTime()) {
    throw new ApiError(400, `The new date must be after ${isoDay(existing.expiresAt)}`);
  }
  if (data.evidenceId) {
    const photo = await prisma.evidence.findFirst({
      where: { id: data.evidenceId, organizationId: ctx.organizationId, propertyId: existing.propertyId },
      select: { id: true },
    });
    if (!photo) throw new ApiError(400, "That photo is not at this store");
  }
  const renewed = await prisma.$transaction(async (tx) => {
    await tx.expiryItem.update({ where: { id: existing.id }, data: { status: ExpiryStatus.RENEWED } });
    return tx.expiryItem.create({
      data: {
        organizationId: existing.organizationId,
        propertyId: existing.propertyId,
        assetId: existing.assetId,
        kind: existing.kind,
        label: existing.label,
        servicedBy: existing.servicedBy,
        notifyContractor: existing.notifyContractor,
        expiresAt: data.expiresAt,
        lastInspectedAt: data.lastInspectedAt,
        evidenceId: data.evidenceId ?? null,
        createdById: ctx.userId,
      },
    });
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "expiry.renewed",
    entityType: "ExpiryItem",
    entityId: renewed.id,
    metadata: { replaced: existing.id, from: isoDay(existing.expiresAt), to: isoDay(renewed.expiresAt) },
  });
  return renewed;
}

/** Stops counting down something that no longer applies: the equipment is gone, the permit was dropped. */
export async function dismissExpiry(ctx: SessionContext, id: string) {
  requireManager(ctx);
  const existing = await loadItem(ctx, id);
  if (existing.status !== ExpiryStatus.ACTIVE) throw new ApiError(409, "This one is no longer active");
  await prisma.expiryItem.update({ where: { id: existing.id }, data: { status: ExpiryStatus.DISMISSED } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "expiry.dismissed",
    entityType: "ExpiryItem",
    entityId: existing.id,
  });
}

/* ------------------------------------------------------------ reminders */

export interface ReminderRunResult {
  checked: number;
  /** Items a reminder went out for. */
  reminded: number;
  overdue: number;
  contractorEmails: number;
  /** Items held back because nobody is responsible for their store yet; tried again next run. */
  noRecipients: number;
  errors: number;
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

type DueItem = {
  item: ItemRow;
  decision: NonNullable<ReturnType<typeof nextReminder>>;
  daysLeft: number;
};

/** What it is and when it runs out: "Fire extinguisher inspection (back door), Extinguisher 3: expires Dec 14, 2026 (27 days left)". */
function itemSummary(due: DueItem): string {
  const { item, daysLeft } = due;
  const what = `${item.kind}${item.label ? ` (${item.label})` : ""}${item.asset ? `, ${item.asset.name}` : ""}`;
  const when = daysLeft < 0 ? `expired ${formatDay(item.expiresAt)}` : `expires ${formatDay(item.expiresAt)}`;
  return `${what}: ${when} (${countdownLabel(daysLeft).toLowerCase()})`;
}

/** The summary plus what a reader at the store can do about it. */
function itemLine(due: DueItem): string {
  const { item } = due;
  const parts = [itemSummary(due)];
  const vendor = item.asset?.serviceVendor;
  if (vendor) parts.push(`Call ${vendor.name}${vendor.contactPhone ? ` ${vendor.contactPhone}` : ""}`);
  if (item.needsReview) parts.push("Read by AI from a photo: please check the date");
  return `• ${parts.join(". ")}`;
}

/**
 * The daily job. For each store, one notice for what is coming up and one for
 * what has expired, to the people responsible for that store, rather than an
 * email per item.
 *
 * Each item is claimed before anything is sent, by an update that only
 * succeeds if it still holds the state this run read. Two overlapping runs
 * therefore cannot both send the same reminder. If delivery then fails, the
 * claim is released so tomorrow's run tries again, and a store nobody is
 * responsible for is retried rather than marked as told.
 */
export async function runExpiryReminders(opts: { now?: Date } = {}): Promise<ReminderRunResult> {
  const now = opts.now ?? new Date();
  const today = calendarDay(now);
  const result: ReminderRunResult = { checked: 0, reminded: 0, overdue: 0, contractorEmails: 0, noRecipients: 0, errors: 0 };

  const items = await prisma.expiryItem.findMany({
    where: {
      status: ExpiryStatus.ACTIVE,
      expiresAt: { lte: new Date(today.getTime() + REMINDER_HORIZON_DAYS * 86_400_000) },
    },
    include: { ...itemInclude, organization: { select: { name: true } } },
    orderBy: [{ propertyId: "asc" }, { expiresAt: "asc" }],
  });
  result.checked = items.length;

  const groups = new Map<string, { upcoming: DueItem[]; overdue: DueItem[]; orgName: string }>();
  for (const item of items) {
    const daysLeft = daysUntil(item.expiresAt, today);
    const decision = nextReminder({
      daysLeft,
      lastReminderDays: item.lastReminderDays,
      lastOverdueNoticeAt: item.lastOverdueNoticeAt,
      today,
    });
    if (!decision) continue;
    const group = groups.get(item.propertyId) ?? { upcoming: [], overdue: [], orgName: item.organization.name };
    (decision.kind === "overdue" ? group.overdue : group.upcoming).push({ item, decision, daysLeft });
    groups.set(item.propertyId, group);
  }

  for (const [propertyId, group] of groups) {
    for (const kind of ["upcoming", "overdue"] as const) {
      const due = group[kind];
      if (due.length === 0) continue;
      try {
        await deliverGroup({ propertyId, kind, due, orgName: group.orgName, now, result });
      } catch (err) {
        result.errors += 1;
        logEvent("expiry.reminder", {
          ok: false,
          propertyId,
          kind,
          errorMessage: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  }
  return result;
}

async function claim(due: DueItem, now: Date): Promise<boolean> {
  const { item, decision } = due;
  const claimed = await prisma.expiryItem.updateMany({
    where:
      decision.kind === "overdue"
        ? { id: item.id, status: ExpiryStatus.ACTIVE, expiresAt: item.expiresAt, lastOverdueNoticeAt: item.lastOverdueNoticeAt }
        : { id: item.id, status: ExpiryStatus.ACTIVE, expiresAt: item.expiresAt, lastReminderDays: item.lastReminderDays },
    data: decision.kind === "overdue" ? { lastOverdueNoticeAt: now } : { lastReminderDays: decision.threshold },
  });
  return claimed.count === 1;
}

async function release(due: DueItem) {
  const { item, decision } = due;
  await prisma.expiryItem.updateMany({
    where: { id: item.id },
    data: decision.kind === "overdue" ? { lastOverdueNoticeAt: item.lastOverdueNoticeAt } : { lastReminderDays: item.lastReminderDays },
  });
}

async function deliverGroup(params: {
  propertyId: string;
  kind: "upcoming" | "overdue";
  due: DueItem[];
  orgName: string;
  now: Date;
  result: ReminderRunResult;
}) {
  const { propertyId, kind, now, result } = params;
  const claimed: DueItem[] = [];
  for (const due of params.due) if (await claim(due, now)) claimed.push(due);
  if (claimed.length === 0) return;

  const propertyName = claimed[0].item.property.name;
  const title =
    claimed.length === 1
      ? `${claimed[0].item.kind} at ${propertyName}: ${countdownLabel(claimed[0].daysLeft).toLowerCase()}`
      : kind === "overdue"
        ? `${claimed.length} items expired at ${propertyName}`
        : `${claimed.length} items expiring soon at ${propertyName}`;

  let recipients = 0;
  try {
    recipients = await notifyPropertyStakeholders({
      propertyId,
      type: kind === "overdue" ? "EXPIRY_OVERDUE" : "EXPIRY_UPCOMING",
      title,
      body: claimed.map(itemLine).join("\n"),
      link: `/expirations?propertyId=${propertyId}`,
    });
  } catch (err) {
    await Promise.all(claimed.map(release));
    throw err;
  }
  if (recipients === 0) {
    await Promise.all(claimed.map(release));
    result.noRecipients += claimed.length;
    return;
  }
  result.reminded += claimed.length;
  if (kind === "overdue") result.overdue += claimed.length;

  // The contractor, when someone chose to copy them. One email per
  // contractor per store, listing what is theirs.
  const byVendor = new Map<string, { vendor: NonNullable<DueItem["item"]["asset"]>["serviceVendor"]; lines: string[] }>();
  for (const due of claimed) {
    const vendor = due.item.asset?.serviceVendor;
    if (!due.item.notifyContractor || !vendor?.contactEmail) continue;
    const entry = byVendor.get(vendor.id) ?? { vendor, lines: [] };
    entry.lines.push(itemSummary(due));
    byVendor.set(vendor.id, entry);
  }
  for (const { vendor, lines } of byVendor.values()) {
    if (!vendor?.contactEmail) continue;
    const sent = await sendEmail(
      contractorExpiryEmail({
        to: vendor.contactEmail,
        contactName: vendor.contactName,
        contractorName: vendor.name,
        organizationName: params.orgName,
        propertyName,
        itemLines: lines,
        overdue: kind === "overdue",
      }),
    );
    if (sent) result.contractorEmails += 1;
  }
  logEvent("expiry.reminder", { ok: true, propertyId, kind, items: claimed.length, recipients });
}
