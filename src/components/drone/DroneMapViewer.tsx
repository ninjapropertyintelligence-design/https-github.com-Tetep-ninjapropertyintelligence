"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import { Button } from "@/components/ui/Button";
import {
  formatArea,
  formatLength,
  pathLengthMeters,
  polygonAreaSquareMeters,
  type LngLat,
} from "@/lib/geo/georeference";

export interface DroneMapLayer {
  /** The capture this map belongs to. */
  captureId: string;
  /** Shown in the date picker, e.g. "Oct 12, 2026". */
  label: string;
  /** The viewable map image and where its corners sit, when it could be placed. */
  overlay: { outputId: string; corners: [LngLat, LngLat, LngLat, LngLat] } | null;
  /** The full-resolution map, for deep zoom once Mapbox has tiled it. */
  fullMap: {
    outputId: string;
    /** Read from the file's header when it was sent for tiling. */
    corners?: [LngLat, LngLat, LngLat, LngLat] | null;
    tiling: { status: string; tileset: string } | null;
  } | null;
}

type Mode = "distance" | "area" | null;

const SOURCE = "drone-map";
const MEASURE = "drone-measure";

/**
 * A drone map on the satellite map, the way DroneDeploy shows one: in its
 * real place, faded against the satellite view, measurable, and — once the
 * full-resolution map has been tiled by Mapbox — zoomable to full detail.
 *
 * Before tiling (or without it) the preview image is placed instead: right
 * position, lower resolution. The panel says which one is showing.
 */
export function DroneMapViewer({
  token,
  layers,
  canPrepareDeepZoom = false,
}: {
  token: string | null;
  layers: DroneMapLayer[];
  /** Whether this person may send a map to be tiled (it costs money). */
  canPrepareDeepZoom?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("mapbox-gl").Map | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(layers[0]?.captureId ?? "");
  const [opacity, setOpacity] = useState(1);
  const [mode, setMode] = useState<Mode>(null);
  const [points, setPoints] = useState<LngLat[]>([]);
  const [tilingByOutput, setTilingByOutput] = useState<Record<string, { status: string; tileset: string } | null>>(() =>
    Object.fromEntries(layers.filter((l) => l.fullMap).map((l) => [l.fullMap!.outputId, l.fullMap!.tiling])),
  );
  const [message, setMessage] = useState<string | null>(null);

  const layer = layers.find((l) => l.captureId === selected) ?? layers[0];
  const tiling = layer?.fullMap ? tilingByOutput[layer.fullMap.outputId] : null;
  const deepZoom = tiling?.status === "READY" ? tiling.tileset : null;
  const placeable = !!deepZoom || !!layer?.overlay;

  // The map itself, once.
  useEffect(() => {
    if (!token || !container.current) return;
    let cancelled = false;
    import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (cancelled || !container.current) return;
      mapboxgl.accessToken = token;
      const first = (layers.find((l) => l.overlay)?.overlay?.corners ?? layers.find((l) => l.fullMap?.corners)?.fullMap?.corners)?.[0];
      const map = new mapboxgl.Map({
        container: container.current,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: first ?? [-98.5, 39.8],
        zoom: first ? 17 : 3,
        maxZoom: 23,
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "top-right");
      map.addControl(new mapboxgl.ScaleControl({ unit: "imperial" }), "bottom-left");
      map.doubleClickZoom.disable();
      map.on("load", () => {
        map.addSource(MEASURE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: `${MEASURE}-fill`, type: "fill", source: MEASURE, filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#f59e0b", "fill-opacity": 0.25 } });
        map.addLayer({ id: `${MEASURE}-line`, type: "line", source: MEASURE, paint: { "line-color": "#f59e0b", "line-width": 2.5 } });
        map.addLayer({ id: `${MEASURE}-points`, type: "circle", source: MEASURE, filter: ["==", "$type", "Point"], paint: { "circle-radius": 4, "circle-color": "#fff", "circle-stroke-color": "#f59e0b", "circle-stroke-width": 2 } });
        mapRef.current = map;
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Built once per token; layers change through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // The drone map layer: tiles when they exist, otherwise the placed preview.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !layer) return;
    if (map.getLayer(SOURCE)) map.removeLayer(SOURCE);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    const before = map.getLayer(`${MEASURE}-fill`) ? `${MEASURE}-fill` : undefined;

    if (deepZoom) {
      map.addSource(SOURCE, { type: "raster", url: `mapbox://${deepZoom}`, tileSize: 256 });
    } else if (layer.overlay) {
      map.addSource(SOURCE, {
        type: "image",
        url: `/api/v1/drone/outputs/${layer.overlay.outputId}/content`,
        coordinates: layer.overlay.corners,
      });
    } else {
      return;
    }
    map.addLayer({ id: SOURCE, type: "raster", source: SOURCE, paint: { "raster-opacity": opacity, "raster-fade-duration": 0 } }, before);

    const corners = layer.overlay?.corners ?? layer.fullMap?.corners;
    if (corners) {
      const lngs = corners.map((c) => c[0]);
      const lats = corners.map((c) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 40, duration: 0 },
      );
    }
    // Opacity is applied by its own effect, without rebuilding the layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, layer?.captureId, deepZoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && map.getLayer(SOURCE)) map.setPaintProperty(SOURCE, "raster-opacity", opacity);
  }, [opacity, ready]);

  // Measuring: each click adds a point while a tool is on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const onClick = (e: import("mapbox-gl").MapMouseEvent) => {
      if (!mode) return;
      setPoints((p) => [...p, [e.lngLat.lng, e.lngLat.lat]]);
    };
    map.on("click", onClick);
    map.getCanvas().style.cursor = mode ? "crosshair" : "";
    return () => {
      map.off("click", onClick);
    };
  }, [mode, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map && ready ? (map.getSource(MEASURE) as import("mapbox-gl").GeoJSONSource | undefined) : undefined;
    if (!source) return;
    const features: GeoJSON.Feature[] = points.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } }));
    if (points.length >= 2) {
      features.push(
        mode === "area" && points.length >= 3
          ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...points, points[0]]] } }
          : { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } },
      );
    }
    source.setData({ type: "FeatureCollection", features });
  }, [points, mode, ready]);

  // While Mapbox is tiling, check back every 30 seconds.
  useEffect(() => {
    const outputId = layer?.fullMap?.outputId;
    if (!outputId || tiling?.status !== "PROCESSING") return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/v1/drone/outputs/${outputId}/tiles`).catch(() => null);
      const payload = (await res?.json().catch(() => null)) as { data?: { tiling: { status: string; tileset: string } | null } } | null;
      if (payload?.data?.tiling) setTilingByOutput((t) => ({ ...t, [outputId]: payload.data!.tiling }));
    }, 30000);
    return () => clearInterval(timer);
  }, [layer?.fullMap?.outputId, tiling?.status]);

  async function prepareDeepZoom() {
    const outputId = layer?.fullMap?.outputId;
    if (!outputId) return;
    setMessage("Sending the full map to be prepared for deep zoom…");
    const res = await fetch(`/api/v1/drone/outputs/${outputId}/tiles`, { method: "POST" }).catch(() => null);
    const payload = (await res?.json().catch(() => null)) as { data?: { tiling: { status: string; tileset: string } }; error?: unknown } | null;
    if (!res?.ok || !payload?.data) {
      setMessage(typeof payload?.error === "string" ? payload.error : "Could not start deep zoom.");
      return;
    }
    setTilingByOutput((t) => ({ ...t, [outputId]: payload.data!.tiling }));
    setMessage(null);
  }

  if (layers.length === 0) return null;

  const measurement =
    mode === "distance" && points.length >= 2
      ? formatLength(pathLengthMeters(points))
      : mode === "area" && points.length >= 3
        ? formatArea(polygonAreaSquareMeters(points))
        : null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {token ? (
        <div className="relative">
          <div ref={container} className="h-[460px] w-full" />
          {!placeable ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-lg bg-black/70 px-3 py-1.5 text-xs text-white">
              This map has no location data, so it cannot be placed — open it below instead.
            </div>
          ) : null}
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-muted">The map needs a Mapbox token: set NEXT_PUBLIC_MAPBOX_TOKEN.</p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-2.5 text-sm">
        {layers.length > 1 ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            Flight
            <select
              value={layer?.captureId}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded border border-border bg-surface px-1.5 py-1 text-sm text-foreground"
            >
              {layers.map((l) => (
                <option key={l.captureId} value={l.captureId}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="flex items-center gap-2 text-xs text-muted">
          Satellite
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            aria-label="Fade between satellite and drone map"
          />
          Drone map
        </label>

        <div className="flex items-center gap-1">
          {(["distance", "area"] as const).map((m) => (
            <Button
              key={m}
              type="button"
              variant={mode === m ? "primary" : "secondary"}
              onClick={() => {
                setMode(mode === m ? null : m);
                setPoints([]);
              }}
            >
              {m === "distance" ? "Measure distance" : "Measure area"}
            </Button>
          ))}
          {points.length > 0 ? (
            <Button type="button" variant="ghost" onClick={() => setPoints([])}>
              Clear
            </Button>
          ) : null}
        </div>
        {mode ? (
          <span className="text-xs text-foreground">
            {measurement ?? (mode === "distance" ? "Click two or more points" : "Click three or more corners")}
          </span>
        ) : null}

        <span className="ml-auto text-xs text-muted">
          {deepZoom
            ? "Full detail (deep zoom)"
            : tiling?.status === "PROCESSING"
              ? "Preparing deep zoom — showing the preview meanwhile"
              : tiling?.status === "FAILED"
                ? "Deep zoom failed — showing the preview"
                : layer?.overlay
                  ? "Preview resolution"
                  : ""}
        </span>
        {canPrepareDeepZoom && layer?.fullMap && (!tiling || tiling.status === "FAILED") ? (
          <Button type="button" variant="secondary" onClick={prepareDeepZoom}>
            Prepare deep zoom
          </Button>
        ) : null}
      </div>
      {message ? <p className="border-t border-border px-4 py-2 text-xs text-muted">{message}</p> : null}
    </div>
  );
}
