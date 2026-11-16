import { prisma } from "@/lib/prisma";
import type { AssetFormOptions } from "@/components/asset/AssetForm";

/** The sections (areas) of a property and the organization's vendors, for the asset form. */
export async function assetFormOptions(organizationId: string, propertyId: string): Promise<AssetFormOptions> {
  const [areas, vendors] = await Promise.all([
    prisma.area.findMany({
      where: { floor: { building: { propertyId } } },
      orderBy: [{ floor: { level: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, floor: { select: { name: true, building: { select: { name: true } } } } },
    }),
    prisma.vendor.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, trade: true } }),
  ]);
  const multiFloor = new Set(areas.map((a) => a.floor.name)).size > 1;
  return {
    areas: areas.map((a) => ({ id: a.id, label: multiFloor ? `${a.floor.name} · ${a.name}` : a.name })),
    vendors: vendors.map((v) => ({ id: v.id, label: v.trade ? `${v.name} (${v.trade})` : v.name })),
  };
}
