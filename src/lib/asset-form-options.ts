import { prisma } from "@/lib/prisma";
import type { AssetFormOptions } from "@/components/asset/AssetForm";

/** The sections (areas) of a property, for the asset form. */
export async function assetFormOptions(propertyId: string): Promise<AssetFormOptions> {
  const areas = await prisma.area.findMany({
    where: { floor: { building: { propertyId } } },
    orderBy: [{ floor: { level: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, floor: { select: { name: true } } },
  });
  const multiFloor = new Set(areas.map((a) => a.floor.name)).size > 1;
  return { areas: areas.map((a) => ({ id: a.id, label: multiFloor ? `${a.floor.name} · ${a.name}` : a.name })) };
}
