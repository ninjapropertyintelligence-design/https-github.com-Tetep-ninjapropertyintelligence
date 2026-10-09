import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
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
  /** Where the property is, so the importer can flag panoramas shot somewhere else. */
  location: { latitude: number; longitude: number } | null;
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
    select: { id: true, latitude: true, longitude: true },
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
    location:
      property.latitude !== null && property.longitude !== null
        ? { latitude: property.latitude, longitude: property.longitude }
        : null,
    panoramas,
  };
}

/** Most checksums one duplicate check may carry — one SD card's worth, and then some. */
export const MAX_CHECKSUM_LOOKUP = 2000;

/**
 * Which of these files this property already has, by SHA-256 of the bytes.
 *
 * The Insta360 importer is pointed at a whole SD card, which still holds last
 * month's shoot as well as today's. It hashes every file in the browser and
 * asks here first, so re-importing the card uploads only what is new instead
 * of filling the gallery with copies. The hash is recorded in the evidence
 * row's metadata at import (`metadata.sha256`).
 */
export async function findExisting360Checksums(
  ctx: SessionContext,
  propertyId: string,
  checksums: string[],
): Promise<string[]> {
  const property = await prisma.property.findFirst({
    where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] },
    select: { id: true },
  });
  if (!property) throw new ApiError(404, "Property not found");
  if (checksums.length > MAX_CHECKSUM_LOOKUP) {
    throw new ApiError(400, `At most ${MAX_CHECKSUM_LOOKUP} checksums per request; this one has ${checksums.length}`);
  }
  const wanted = [...new Set(checksums.map((c) => c.toLowerCase()).filter((c) => /^[0-9a-f]{64}$/.test(c)))];
  if (wanted.length === 0) return [];
  const rows = await prisma.$queryRaw<Array<{ sha: string }>>(Prisma.sql`
    SELECT DISTINCT "metadata"->>'sha256' AS sha
    FROM "Evidence"
    WHERE "organizationId" = ${ctx.organizationId}
      AND "propertyId" = ${property.id}
      AND "type" = 'IMAGE_360'
      AND "metadata"->>'sha256' = ANY(${wanted})
  `);
  return rows.map((r) => r.sha);
}
