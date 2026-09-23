import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { FEATURE_FLAGS, isFeatureEnabled } from "@/lib/feature-flags";

/**
 * 360 panoramas for one property.
 *
 * 360 is the third sellable capture kind — a handheld or tripod 360 camera,
 * alongside Matterport for interiors and drone for exteriors. Unlike those
 * two it has no integration behind it: the camera produces an equirectangular
 * JPEG and it is uploaded like any other evidence, which is why it is stored
 * as `Evidence` of type `IMAGE_360` rather than in a model of its own.
 *
 * Reading is deliberately NOT gated. An organization whose 360 entitlement
 * has lapsed must still be able to see the panoramas it already paid to
 * capture, and the tab has to be able to render the upsell. `enabled` is
 * reported so the UI can show one or the other; capture itself is gated in
 * `createEvidence`.
 */

export interface Panorama360 {
  id: string;
  label: string;
  /** When the panorama was shot. Null when the camera recorded no date. */
  capturedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  /**
   * Same-origin, not a presigned storage URL. WebGL will not texture a
   * cross-origin image that carries no CORS headers, and the object store's
   * presigned responses carry none — so a panorama served straight from
   * storage fails in the viewer while rendering fine in an <img>. The route
   * behind this path streams the bytes from this origin and sets the
   * recorded content type.
   */
  imageUrl: string;
}

export interface Property360Data {
  propertyId: string;
  /** Whether this organization can capture NEW panoramas. */
  enabled: boolean;
  panoramas: Panorama360[];
}

/**
 * A readable name for a panorama.
 *
 * Storage keys are `<orgId>/<uuid>-<original filename>`, so the filename is
 * everything after the first hyphen that follows the UUID. Falling back to a
 * generic label is deliberate: a key that does not match the pattern should
 * produce "360 panorama", not a slice of a UUID presented as a name.
 */
function labelFor(storageKey: string, index: number): string {
  const basename = storageKey.split("/").pop() ?? storageKey;
  const withoutUuid = basename.replace(/^[0-9a-f-]{36}-/i, "");
  const name = withoutUuid === basename ? "" : withoutUuid;
  return name || `360 panorama ${index + 1}`;
}

export async function getProperty360Data(ctx: SessionContext, propertyId: string): Promise<Property360Data> {
  const property = await prisma.property.findFirst({
    where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] },
    select: { id: true },
  });
  if (!property) throw new ApiError(404, "Property not found");

  const rows = await prisma.evidence.findMany({
    where: { propertyId, type: "IMAGE_360" },
    // By capture date, newest first — the date the panorama was shot, not the
    // date its row was written. A backfilled shoot uploaded last week is not
    // the most recent view of the site. Undated rows sort last rather than
    // first, which is what NULL would otherwise do.
    orderBy: [{ captureDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true, storageKey: true, captureDate: true, latitude: true, longitude: true },
    take: 200,
  });

  const panoramas = rows.map((row, index) => ({
    id: row.id,
    label: labelFor(row.storageKey, index),
    capturedAt: row.captureDate,
    latitude: row.latitude,
    longitude: row.longitude,
    imageUrl: `/api/v1/evidence/${row.id}/content`,
  }));

  return {
    propertyId,
    enabled: await isFeatureEnabled(ctx.organizationId || null, FEATURE_FLAGS.IMAGE_360),
    panoramas,
  };
}
