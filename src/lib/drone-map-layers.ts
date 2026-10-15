import type { DroneMapLayer } from "@/components/drone/DroneMapViewer";
import type { LngLat } from "@/lib/geo/georeference";
import { tilingOf } from "@/lib/drone-map-service";
import { formatDate } from "@/lib/format";

interface CaptureForMap {
  id: string;
  capturedAt: Date | string | null;
  createdAt: Date | string;
  outputs: Array<{ id: string; outputType: string; storageKey: string; metadata: unknown }>;
}

function cornersOf(metadata: unknown): [LngLat, LngLat, LngLat, LngLat] | null {
  const corners = (metadata as { corners?: unknown } | null)?.corners;
  if (!Array.isArray(corners) || corners.length !== 4) return null;
  const ok = corners.every(
    (c) => Array.isArray(c) && c.length === 2 && c.every((n) => typeof n === "number" && Number.isFinite(n)),
  );
  return ok ? (corners as [LngLat, LngLat, LngLat, LngLat]) : null;
}

/**
 * The drone map viewer's layers, one per flight: the placed preview and the
 * full-resolution GeoTIFF (for deep zoom). A flight with neither is left out.
 */
export function droneMapLayersFor(captures: CaptureForMap[]): DroneMapLayer[] {
  const layers: DroneMapLayer[] = [];
  for (const capture of captures) {
    const placed = capture.outputs.find((o) => o.outputType === "ORTHOMOSAIC" && cornersOf(o.metadata));
    const full = capture.outputs.find(
      (o) => o.outputType === "ORTHOMOSAIC" && /\.tiff?$/i.test(o.storageKey) && !(o.metadata as { preview?: boolean } | null)?.preview,
    );
    if (!placed && !full) continue;
    const tiling = full ? tilingOf(full.metadata) : null;
    layers.push({
      captureId: capture.id,
      label: formatDate(capture.capturedAt ?? capture.createdAt),
      overlay: placed ? { outputId: placed.id, corners: cornersOf(placed.metadata)! } : null,
      fullMap: full
        ? {
            outputId: full.id,
            corners: cornersOf(full.metadata),
            tiling: tiling ? { status: tiling.status, tileset: tiling.tileset } : null,
          }
        : null,
    });
  }
  return layers;
}
