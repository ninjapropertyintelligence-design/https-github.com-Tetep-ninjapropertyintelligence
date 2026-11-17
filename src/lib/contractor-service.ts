import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Contractors: the companies an owner calls when something breaks.
 *
 * A contractor is a `Vendor`. It carries who to ask for, a normal number and
 * an after-hours number, and the stores it serves, either all of them or a
 * list. A piece of equipment can name the contractor that services it; where
 * it doesn't, the stores' contractors are offered by trade.
 */

export const CONTRACTOR_TRADES = [
  "Refrigeration",
  "Kitchen equipment",
  "HVAC",
  "Plumbing",
  "Electrical",
  "Gas",
  "Fire suppression",
  "Hood and grease cleaning",
  "Pest control",
  "Roofing",
  "Grounds and landscaping",
  "Draft and beverage",
  "IT and POS",
  "General repair",
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const contractorSchema = z.object({
  name: z.string().trim().min(1, "A contractor needs a name").max(200),
  trade: optionalText(100),
  contactName: optionalText(200),
  contactEmail: z
    .string()
    .trim()
    .email("That is not a valid email address")
    .nullish()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  contactPhone: optionalText(50),
  emergencyPhone: optionalText(50),
  notes: optionalText(2000),
  servesAllProperties: z.boolean().default(false),
  /** Stores served, when not all of them. Ignored when `servesAllProperties` is set. */
  propertyIds: z.array(z.string().min(1)).max(1000).default([]),
});

export type ContractorInput = z.infer<typeof contractorSchema>;

function requireManager(ctx: SessionContext) {
  if (!hasPermission(ctx.role, "canManageVendors")) throw new ApiError(403, "Missing permission: canManageVendors");
}

/** Contractor details are for the people who manage the portfolio, not for the contractors themselves. */
function requireReader(ctx: SessionContext) {
  if (!hasPermission(ctx.role, "canManageVendors") && !hasPermission(ctx.role, "canViewPortfolio")) {
    throw new ApiError(403, "You don't have access to contractors");
  }
}

async function loadContractor(ctx: SessionContext, id: string) {
  const vendor = await prisma.vendor.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!vendor) throw new ApiError(404, "Contractor not found");
  return vendor;
}

/** Throws unless every id is a store this session can see. Returns the ids, de-duplicated. */
async function assertPropertiesInScope(ctx: SessionContext, propertyIds: string[]) {
  const ids = [...new Set(propertyIds)];
  if (ids.length === 0) return ids;
  const found = await prisma.property.count({
    where: { AND: [{ id: { in: ids } }, propertyScopeWhere(ctx)] },
  });
  if (found !== ids.length) throw new ApiError(400, "One of those stores is not in your portfolio");
  return ids;
}

const contractorInclude = {
  properties: { select: { propertyId: true, property: { select: { id: true, name: true } } } },
  _count: { select: { serviceAssets: true } },
} satisfies Prisma.VendorInclude;

export async function listContractors(ctx: SessionContext, opts: { propertyId?: string; trade?: string } = {}) {
  requireReader(ctx);
  const where: Prisma.VendorWhereInput = { organizationId: ctx.organizationId };
  if (opts.trade) where.trade = opts.trade;
  if (opts.propertyId) {
    where.OR = [{ servesAllProperties: true }, { properties: { some: { propertyId: opts.propertyId } } }];
  }
  return prisma.vendor.findMany({ where, orderBy: [{ trade: "asc" }, { name: "asc" }], include: contractorInclude });
}

export async function getContractor(ctx: SessionContext, id: string) {
  requireReader(ctx);
  const vendor = await prisma.vendor.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      ...contractorInclude,
      serviceAssets: {
        where: { property: propertyScopeWhere(ctx) },
        select: { id: true, name: true, assetType: true, property: { select: { id: true, name: true } } },
        orderBy: { name: "asc" },
        take: 200,
      },
    },
  });
  if (!vendor) throw new ApiError(404, "Contractor not found");
  return vendor;
}

export async function createContractor(ctx: SessionContext, input: unknown) {
  requireManager(ctx);
  const data = contractorSchema.parse(input);
  const propertyIds = data.servesAllProperties ? [] : await assertPropertiesInScope(ctx, data.propertyIds);
  const { propertyIds: _ignored, ...fields } = data;
  void _ignored;
  const vendor = await prisma.vendor.create({
    data: {
      organizationId: ctx.organizationId,
      ...fields,
      properties: { create: propertyIds.map((propertyId) => ({ propertyId })) },
    },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "contractor.created",
    entityType: "Vendor",
    entityId: vendor.id,
  });
  return vendor;
}

export async function updateContractor(ctx: SessionContext, id: string, input: unknown) {
  requireManager(ctx);
  const existing = await loadContractor(ctx, id);
  const data = contractorSchema.parse(input);
  const propertyIds = data.servesAllProperties ? [] : await assertPropertiesInScope(ctx, data.propertyIds);
  const { propertyIds: _ignored, ...fields } = data;
  void _ignored;

  // A manager scoped to some stores sees and edits only those links. The
  // stores they cannot see stay as they were, so saving a regional list never
  // quietly drops another region's stores.
  const visible = await prisma.property.findMany({ where: propertyScopeWhere(ctx), select: { id: true } });
  const visibleIds = visible.map((p) => p.id);

  await prisma.$transaction(async (tx) => {
    await tx.vendor.update({ where: { id: existing.id }, data: fields });
    await tx.vendorProperty.deleteMany({ where: { vendorId: existing.id, propertyId: { in: visibleIds } } });
    if (propertyIds.length > 0) {
      await tx.vendorProperty.createMany({ data: propertyIds.map((propertyId) => ({ vendorId: existing.id, propertyId })) });
    }
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "contractor.updated",
    entityType: "Vendor",
    entityId: existing.id,
  });
  return prisma.vendor.findUniqueOrThrow({ where: { id: existing.id }, include: contractorInclude });
}

/**
 * Removes a contractor nobody depends on. One with login accounts or capture
 * jobs is a business relationship, not a phone-book entry, so it is refused
 * rather than cut loose from them.
 */
export async function deleteContractor(ctx: SessionContext, id: string) {
  requireManager(ctx);
  const vendor = await loadContractor(ctx, id);
  const [members, jobs] = await Promise.all([
    prisma.membership.count({ where: { vendorId: vendor.id } }),
    prisma.captureJob.count({ where: { vendorId: vendor.id } }),
  ]);
  if (members > 0 || jobs > 0) {
    throw new ApiError(409, "This contractor has team logins or capture jobs, so it can't be deleted");
  }
  await prisma.vendor.delete({ where: { id: vendor.id } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "contractor.deleted",
    entityType: "Vendor",
    entityId: vendor.id,
    metadata: { name: vendor.name },
  });
}

async function loadScopedAsset(ctx: SessionContext, assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { AND: [{ id: assetId }, { organizationId: ctx.organizationId }, { property: propertyScopeWhere(ctx) }] },
    select: { id: true, propertyId: true, assetType: true, serviceVendorId: true, system: { select: { category: true } } },
  });
  if (!asset) throw new ApiError(404, "Asset not found");
  return asset;
}

/** Names (or clears, with null) the contractor that services an asset. */
export async function setAssetContractor(ctx: SessionContext, assetId: string, vendorId: string | null) {
  if (!hasPermission(ctx.role, "canManageAssets")) throw new ApiError(403, "Missing permission: canManageAssets");
  const asset = await loadScopedAsset(ctx, assetId);
  if (vendorId) await loadContractor(ctx, vendorId);
  await prisma.asset.update({ where: { id: asset.id }, data: { serviceVendorId: vendorId, updatedBy: ctx.userId } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "asset.contractor_set",
    entityType: "Asset",
    entityId: asset.id,
    metadata: { vendorId },
  });
}

/**
 * Who to call for an asset. The contractor named on the asset comes first;
 * after it, the contractors that serve the asset's store, so a piece of
 * equipment nobody has assigned still points somewhere.
 */
export async function whoToCall(ctx: SessionContext, assetId: string) {
  requireReader(ctx);
  const asset = await loadScopedAsset(ctx, assetId);
  const assigned = asset.serviceVendorId
    ? await prisma.vendor.findFirst({ where: { id: asset.serviceVendorId, organizationId: ctx.organizationId } })
    : null;
  const atStore = await prisma.vendor.findMany({
    where: {
      organizationId: ctx.organizationId,
      id: assigned ? { not: assigned.id } : undefined,
      OR: [{ servesAllProperties: true }, { properties: { some: { propertyId: asset.propertyId } } }],
    },
    orderBy: [{ trade: "asc" }, { name: "asc" }],
  });
  return { assigned, others: atStore };
}
