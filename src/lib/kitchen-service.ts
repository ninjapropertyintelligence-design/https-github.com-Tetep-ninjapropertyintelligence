import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { hasPermission } from "@/lib/permissions";
import { recalculatePropertyHealth } from "@/lib/scoring";
import { canAccessProperty, type SessionContext } from "@/lib/tenant-scope";
import { createTemplate } from "@/lib/template-service";
import {
  KITCHEN_AUDIT_TEMPLATE_NAME,
  KITCHEN_ZONE_AREA_TYPE,
  KITCHEN_ZONES,
  kitchenAuditTemplateDefinition,
} from "@/lib/restaurant-kitchen";

/**
 * Sets a restaurant property up with the kitchen catalog: an Area per zone
 * and an Asset per piece of equipment, filed under its zone.
 *
 * Safe to run again: a zone that already exists is reused, and equipment
 * whose type the property already has is left alone, so a second run only
 * fills in what is missing and never duplicates what an owner has edited.
 */
export async function writeKitchenEquipment(organizationId: string, propertyId: string, actorUserId: string | null) {
  // Areas hang off a floor, and floors off a building. A property set up for
  // the kitchen alone has neither, so the first of each is made here.
  const building =
    (await prisma.building.findFirst({ where: { propertyId }, orderBy: { createdAt: "asc" } })) ??
    (await prisma.building.create({ data: { propertyId, name: "Main Building" } }));
  const floor =
    (await prisma.floor.findFirst({ where: { buildingId: building.id }, orderBy: [{ level: "asc" }, { createdAt: "asc" }] })) ??
    (await prisma.floor.create({ data: { buildingId: building.id, name: "Ground Floor", level: 0 } }));

  const existingTypes = new Set(
    (await prisma.asset.findMany({ where: { propertyId }, select: { assetType: true } })).map((a) => a.assetType),
  );

  const created: Array<{ id: string; name: string }> = [];
  let skipped = 0;
  for (const zone of KITCHEN_ZONES) {
    const areaSelect = { id: true, floorId: true, floor: { select: { buildingId: true } } } as const;
    const area =
      (await prisma.area.findFirst({ where: { name: zone.name, floor: { building: { propertyId } } }, select: areaSelect })) ??
      (await prisma.area.create({ data: { floorId: floor.id, name: zone.name, areaType: KITCHEN_ZONE_AREA_TYPE }, select: areaSelect }));
    for (const item of zone.equipment) {
      if (existingTypes.has(item.assetType)) {
        skipped += 1;
        continue;
      }
      const asset = await prisma.asset.create({
        data: {
          organizationId,
          propertyId,
          buildingId: area.floor.buildingId,
          floorId: area.floorId,
          areaId: area.id,
          name: item.assetType,
          assetType: item.assetType,
          criticalityScore: item.criticality,
          updatedBy: actorUserId,
        },
        select: { id: true, name: true },
      });
      created.push(asset);
    }
  }
  return { created, skipped };
}

/** Adds the kitchen catalog to a property the caller can manage assets on. */
export async function addKitchenEquipment(ctx: SessionContext, propertyId: string) {
  if (!hasPermission(ctx.role, "canManageAssets")) throw new ApiError(403, "Missing permission: canManageAssets");
  if (!(await canAccessProperty(ctx, propertyId))) throw new ApiError(404, "Property not found");

  const result = await writeKitchenEquipment(ctx.organizationId, propertyId, ctx.userId);
  if (result.created.length > 0) {
    await recalculatePropertyHealth(propertyId);
    await Promise.all([
      ...result.created.map((asset) =>
        emitEvent({
          organizationId: ctx.organizationId,
          propertyId,
          type: EVENT_TYPES.ASSET_CREATED,
          actorUserId: ctx.userId,
          payload: { assetId: asset.id, name: asset.name },
        }),
      ),
      writeAuditLog({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "asset.kitchen_catalog_added",
        entityType: "Property",
        entityId: propertyId,
        metadata: { created: result.created.length, skipped: result.skipped },
      }),
    ]);
  }
  return { created: result.created.length, skipped: result.skipped };
}

/**
 * Adds the "Restaurant Kitchen Audit" template to the organization, unless an
 * active one by that name is already there, in which case that one is
 * returned: two identical templates in the scheduling list helps nobody.
 */
export async function installKitchenAuditTemplate(ctx: SessionContext) {
  const existing = await prisma.assessmentTemplate.findFirst({
    where: { organizationId: ctx.organizationId, name: KITCHEN_AUDIT_TEMPLATE_NAME, isActive: true },
  });
  if (existing) {
    if (!hasPermission(ctx.role, "canManageAssessmentTemplates")) {
      throw new ApiError(403, "Missing permission: canManageAssessmentTemplates");
    }
    return { template: existing, created: false };
  }
  return { template: await createTemplate(ctx, kitchenAuditTemplateDefinition()), created: true };
}
