import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";

/**
 * Checks the references an asset is saved with: the building, floor and area
 * must be in the asset's own property, and the service vendor in the same
 * organization. Ids come from the client, so each is looked up rather than
 * trusted, and a wrong one is named in the error.
 */
export async function assertAssetRefs(
  organizationId: string,
  propertyId: string,
  refs: { buildingId?: string | null; floorId?: string | null; areaId?: string | null; serviceVendorId?: string | null },
) {
  const [building, floor, area, vendor] = await Promise.all([
    refs.buildingId ? prisma.building.findFirst({ where: { id: refs.buildingId, propertyId }, select: { id: true } }) : true,
    refs.floorId ? prisma.floor.findFirst({ where: { id: refs.floorId, building: { propertyId } }, select: { id: true } }) : true,
    refs.areaId ? prisma.area.findFirst({ where: { id: refs.areaId, floor: { building: { propertyId } } }, select: { id: true } }) : true,
    refs.serviceVendorId
      ? prisma.vendor.findFirst({ where: { id: refs.serviceVendorId, organizationId }, select: { id: true } })
      : true,
  ]);
  if (!building) throw new ApiError(400, "That building is not in this property");
  if (!floor) throw new ApiError(400, "That floor is not in this property");
  if (!area) throw new ApiError(400, "That area is not in this property");
  if (!vendor) throw new ApiError(400, "That service contact is not one of your vendors");
}
