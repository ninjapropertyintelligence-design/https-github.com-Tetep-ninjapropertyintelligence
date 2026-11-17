import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { getMatterportProvider } from "@/lib/integrations/matterport-provider";
import { captureReviewWhere, evidenceScopeWhere, propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";

/**
 * Where a piece of equipment is, in the three ways the platform can show it:
 * the Matterport 3D tour, 360 photos (Insta360 and others), and aerial
 * imagery (drone flights, including DroneDeploy's).
 *
 * This only reads what those captures already hold, plus one thing the
 * platform had no way to record: a pin tying a piece of equipment to a
 * position in the tour.
 */

export interface TourPin {
  id: string;
  label: string | null;
  sweepId: string;
  /** Opens the tour at that position. */
  url: string | null;
}

export interface AssetLocation {
  propertyId: string;
  area: string | null;
  tour: {
    linked: boolean;
    spaceName: string | null;
    /** The tour as a whole, when the viewer is configured. */
    url: string | null;
    pins: TourPin[];
  };
  panoramas: {
    /** 360 photos tagged to this equipment. */
    ofThisAsset: Array<{ id: string; capturedAt: Date | null }>;
    /** 360 photos at the whole store. */
    atStore: number;
  };
  aerial: {
    /** The latest flight at the store that is ready to view. */
    latest: { id: string; capturedAt: Date | null; fromDroneDeploy: boolean } | null;
    /** Marks placed on aerial imagery for this equipment. */
    markers: number;
  };
}

/** Where a pin opens: the tour's own URL with Matterport's position parameter. */
function pinUrl(tourUrl: string | null, sweepId: string): string | null {
  if (!tourUrl) return null;
  return `${tourUrl}${tourUrl.includes("?") ? "&" : "?"}ss=${encodeURIComponent(sweepId)}`;
}

export async function getAssetLocation(ctx: SessionContext, assetId: string): Promise<AssetLocation> {
  const asset = await prisma.asset.findFirst({
    where: { AND: [{ id: assetId }, { organizationId: ctx.organizationId }, { property: propertyScopeWhere(ctx) }] },
    select: { id: true, propertyId: true, area: { select: { name: true } } },
  });
  if (!asset) throw new ApiError(404, "Asset not found");

  const [link, tagged, atStore, latestFlight, markers] = await Promise.all([
    prisma.matterportPropertyLink.findFirst({
      where: { propertyId: asset.propertyId, ...captureReviewWhere(ctx) },
      orderBy: { linkedAt: "desc" },
      include: { space: { select: { externalSpaceId: true, name: true } }, references: { where: { assetId: asset.id, sweepId: { not: null } } } },
    }),
    prisma.evidence.findMany({
      where: { ...evidenceScopeWhere(ctx), assetId: asset.id, type: "IMAGE_360" },
      orderBy: [{ captureDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: { id: true, captureDate: true },
      take: 12,
    }),
    prisma.evidence.count({ where: { ...evidenceScopeWhere(ctx), propertyId: asset.propertyId, type: "IMAGE_360" } }),
    prisma.droneCapture.findFirst({
      where: { propertyId: asset.propertyId, status: "READY", ...captureReviewWhere(ctx) },
      orderBy: { capturedAt: { sort: "desc", nulls: "last" } },
      select: { id: true, capturedAt: true, droneDeployImport: { select: { id: true } } },
    }),
    prisma.exteriorMarker.count({ where: { assetId: asset.id, propertyId: asset.propertyId } }),
  ]);

  const tourUrl = link ? getMatterportProvider().getViewerConfig(link.space.externalSpaceId).embedUrl : null;
  return {
    propertyId: asset.propertyId,
    area: asset.area?.name ?? null,
    tour: {
      linked: !!link,
      spaceName: link?.space.name ?? null,
      url: tourUrl,
      pins: (link?.references ?? []).map((r) => ({ id: r.id, label: r.label, sweepId: r.sweepId as string, url: pinUrl(tourUrl, r.sweepId as string) })),
    },
    panoramas: { ofThisAsset: tagged.map((t) => ({ id: t.id, capturedAt: t.captureDate })), atStore },
    aerial: {
      latest: latestFlight
        ? { id: latestFlight.id, capturedAt: latestFlight.capturedAt, fromDroneDeploy: !!latestFlight.droneDeployImport }
        : null,
      markers,
    },
  };
}

/**
 * Reads the space and the position out of a Matterport link: the `m=` and
 * `ss=` of "https://my.matterport.com/show/?m=ABC&ss=XYZ". Null when it is
 * not a Matterport link, or names no position.
 */
export function parseTourLink(input: string): { spaceId: string; sweepId: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/(^|\.)matterport\.com$/i.test(url.hostname)) return null;
  const spaceId = url.searchParams.get("m");
  const sweepId = url.searchParams.get("ss");
  if (!spaceId || !sweepId) return null;
  if (!/^[A-Za-z0-9]+$/.test(spaceId) || !/^[A-Za-z0-9]+$/.test(sweepId)) return null;
  return { spaceId, sweepId };
}

/**
 * Pins a piece of equipment to a spot in the store's 3D tour. Whoever stands
 * at the spot in the tour copies the link from their browser; its position is
 * what is kept. The tour has to be the one linked to this store: a link from
 * another space would send people to somebody else's building.
 */
export async function pinAssetToTour(ctx: SessionContext, assetId: string, input: { url: string; label?: string | null }) {
  if (!hasPermission(ctx.role, "canManageAssets")) throw new ApiError(403, "Missing permission: canManageAssets");
  const asset = await prisma.asset.findFirst({
    where: { AND: [{ id: assetId }, { organizationId: ctx.organizationId }, { property: propertyScopeWhere(ctx) }] },
    select: { id: true, propertyId: true, areaId: true },
  });
  if (!asset) throw new ApiError(404, "Asset not found");

  const parsed = parseTourLink(input.url);
  if (!parsed) {
    throw new ApiError(400, "Paste the Matterport link from your browser while standing at the spot (it contains m= and ss=)");
  }
  const link = await prisma.matterportPropertyLink.findFirst({
    where: { propertyId: asset.propertyId, ...captureReviewWhere(ctx) },
    orderBy: { linkedAt: "desc" },
    include: { space: { select: { externalSpaceId: true } } },
  });
  if (!link) throw new ApiError(409, "This store has no 3D tour linked yet. Link it on the Interior tab first");
  if (link.space.externalSpaceId !== parsed.spaceId) {
    throw new ApiError(400, "That link is for a different 3D tour than the one linked to this store");
  }

  const label = input.label?.trim().slice(0, 200) || null;
  const existing = await prisma.matterportReference.findFirst({ where: { linkId: link.id, assetId: asset.id, sweepId: parsed.sweepId } });
  const pin =
    existing ??
    (await prisma.matterportReference.create({
      data: { linkId: link.id, assetId: asset.id, areaId: asset.areaId, sweepId: parsed.sweepId, label },
    }));
  if (existing && label && label !== existing.label) {
    await prisma.matterportReference.update({ where: { id: existing.id }, data: { label } });
  }
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "asset.tour_pinned",
    entityType: "Asset",
    entityId: asset.id,
    metadata: { sweepId: parsed.sweepId },
  });
  return pin;
}

export async function removeTourPin(ctx: SessionContext, assetId: string, pinId: string) {
  if (!hasPermission(ctx.role, "canManageAssets")) throw new ApiError(403, "Missing permission: canManageAssets");
  const pin = await prisma.matterportReference.findFirst({
    where: { id: pinId, assetId, asset: { organizationId: ctx.organizationId, property: propertyScopeWhere(ctx) } },
    select: { id: true },
  });
  if (!pin) throw new ApiError(404, "Pin not found");
  await prisma.matterportReference.delete({ where: { id: pin.id } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "asset.tour_unpinned",
    entityType: "Asset",
    entityId: assetId,
  });
}
