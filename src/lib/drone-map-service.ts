import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { Prisma } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/permissions";
import { captureReviewWhere, propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { getStorageProvider } from "@/lib/storage";
import { getMapboxUpload, mapboxTilingConfig, startMapboxTiling } from "@/lib/integrations/mapbox-tiling";
import { logEvent } from "@/lib/observability";
import { cornersFromBBox, isSupportedEpsg, type LngLat } from "@/lib/geo/georeference";

/**
 * What the drone map viewer needs from a stored output: the map image to lay
 * on the world map, where it goes, and — once Mapbox has tiled the full map —
 * the tileset that gives deep zoom.
 */

export interface TilingState {
  status: "PROCESSING" | "READY" | "FAILED";
  uploadId: string;
  tileset: string;
  error?: string;
  startedAt: string;
}

export function tilingOf(metadata: unknown): TilingState | null {
  const t = (metadata as { tiling?: TilingState } | null)?.tiling;
  return t && typeof t.tileset === "string" ? t : null;
}

/** One output the caller may see: in scope, and approved unless they review or delivered it. */
export async function loadViewableOutput(ctx: SessionContext, outputId: string) {
  const output = await prisma.droneOutput.findFirst({
    where: {
      id: outputId,
      dataset: { capture: { AND: [{ property: propertyScopeWhere(ctx) }, captureReviewWhere(ctx)] } },
    },
  });
  if (!output) throw new ApiError(404, "Drone output not found");
  return output;
}

/** A raw drone photo, under the same scope and review rules as the outputs. */
export async function loadViewableDroneImage(ctx: SessionContext, imageId: string) {
  const image = await prisma.droneImage.findFirst({
    where: {
      id: imageId,
      dataset: { capture: { AND: [{ property: propertyScopeWhere(ctx) }, captureReviewWhere(ctx)] } },
    },
  });
  if (!image) throw new ApiError(404, "Drone photo not found");
  return image;
}

function isGeoTiff(storageKey: string) {
  return /\.tiff?$/i.test(storageKey);
}

/**
 * Sends a full-resolution map to Mapbox to be tiled for deep zoom. Started by
 * whoever delivered or manages the work — not by a read-only viewer, since it
 * costs money. Idempotent: a map already tiled, or being tiled, is left alone.
 */
export async function requestOutputTiling(ctx: SessionContext, outputId: string) {
  if (!hasPermission(ctx.role, "canPerformCapture") && !hasPermission(ctx.role, "canManageCaptureJobs")) {
    throw new ApiError(403, "Only the team that delivers or reviews drone work can prepare deep zoom");
  }
  const output = await loadViewableOutput(ctx, outputId);
  return startTilingForOutput(output.id);
}

/** System entry point (also used by the DroneDeploy import). */
export async function startTilingForOutput(outputId: string) {
  const output = await prisma.droneOutput.findUniqueOrThrow({ where: { id: outputId } });
  if (output.outputType !== "ORTHOMOSAIC" || !isGeoTiff(output.storageKey)) {
    throw new ApiError(400, "Deep zoom is prepared from the full-resolution GeoTIFF map");
  }
  const existing = tilingOf(output.metadata);
  if (existing && existing.status !== "FAILED") return existing;
  if (!mapboxTilingConfig()) {
    throw new ApiError(400, "Deep zoom is not set up yet: MAPBOX_UPLOAD_TOKEN and MAPBOX_USERNAME are needed");
  }
  if (output.sizeBytes === null) throw new ApiError(400, "The map's size is unknown, so it cannot be sent for tiling");

  const sourceUrl = await getStorageProvider().getDownloadUrl(output.storageKey);
  // Where the map is, from the file's own header — so the viewer can centre
  // on it even when there is no preview image (a DroneDeploy import).
  const corners = await readGeoTiffCorners(sourceUrl);
  const { uploadId, tileset } = await startMapboxTiling({
    sourceUrl,
    sizeBytes: Number(output.sizeBytes),
    name: output.storageKey.split("/").pop() ?? "drone map",
  });
  const tiling: TilingState = { status: "PROCESSING", uploadId, tileset, startedAt: new Date().toISOString() };
  await saveTiling(output.id, corners ? { ...(output.metadata as object), corners } : output.metadata, tiling);
  return tiling;
}

/**
 * The four corners of a GeoTIFF, read from its header with range requests —
 * a few kilobytes, never the whole file. Null when the file is not
 * georeferenced in a system that can be converted.
 */
export async function readGeoTiffCorners(url: string): Promise<[LngLat, LngLat, LngLat, LngLat] | null> {
  try {
    const { fromUrl } = await import("geotiff");
    const tiff = await fromUrl(url);
    const image = await tiff.getImage(0);
    const keys = (image.getGeoKeys?.() ?? {}) as { ProjectedCSTypeGeoKey?: number; GeographicTypeGeoKey?: number };
    const epsg = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey ?? null;
    if (!epsg || !isSupportedEpsg(epsg)) return null;
    return cornersFromBBox(image.getBoundingBox() as [number, number, number, number], epsg);
  } catch {
    return null;
  }
}

/** Checks on a map being tiled and records the outcome. */
export async function refreshOutputTiling(ctx: SessionContext, outputId: string) {
  const output = await loadViewableOutput(ctx, outputId);
  const tiling = tilingOf(output.metadata);
  if (!tiling || tiling.status !== "PROCESSING" || !mapboxTilingConfig()) return tiling;
  const state = await getMapboxUpload(tiling.uploadId);
  if (state.state === "PROCESSING") return tiling;
  const next: TilingState =
    state.state === "READY" ? { ...tiling, status: "READY" } : { ...tiling, status: "FAILED", error: state.error };
  await saveTiling(output.id, output.metadata, next);
  if (next.status === "FAILED") {
    logEvent("mapbox.api_call", { ok: false, errorMessage: `Tiling failed: ${next.error}` });
  }
  return next;
}

async function saveTiling(outputId: string, metadata: unknown, tiling: TilingState) {
  const base = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  await prisma.droneOutput.update({
    where: { id: outputId },
    data: { metadata: { ...base, tiling } as unknown as Prisma.InputJsonValue },
  });
}
