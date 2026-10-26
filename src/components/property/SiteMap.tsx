"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "mapbox-gl/dist/mapbox-gl.css";
import type { SiteLayer, SiteMarker } from "@/lib/site-map";
import { boundsToCorners } from "@/lib/overlay-validation";
import { apiRequest } from "@/components/settings/api-request";
import type { LngLat } from "@/lib/annotation-validation";

const AREAS_KEY = "areas-of-interest";
const DRAFT_SOURCE = "annotation-draft";

type DrawMode = "POINT" | "AREA" | null;

/** A map overlay as the site map needs it. Edges are null for a vector layer. */
export interface SiteOverlayOption {
  id: string;
  kind: "RASTER" | "VECTOR";
  name: string;
  categoryLabel: string;
  north: number | null;
  south: number | null;
  east: number | null;
  west: number | null;
  defaultOpacity: number;
  isDefault: boolean;
}

const VECTOR_COLOR = "#f59e0b";
const overlaySourceId = (id: string) => `overlay-${id}`;
const overlayLayerIds = (o: SiteOverlayOption) =>
  o.kind === "RASTER"
    ? [`overlay-${o.id}-raster`]
    : [`overlay-${o.id}-fill`, `overlay-${o.id}-line`, `overlay-${o.id}-point`];

/** Serialised across the server/client boundary — a Date does not survive it. */
export interface SiteCaptureOption {
  id: string;
  capturedAt: string | null;
  droneModel: string | null;
  status: string;
}

export interface SiteMapProps {
  token: string | null;
  property: {
    id: string;
    name: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    customerPropertyId: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  /** ISO string — a Date cannot cross the server/client boundary as one. */
  lastCaptureAt: string | null;
  captures: SiteCaptureOption[];
  selectedCaptureId: string | null;
  totalMedia: number;
  layers: SiteLayer[];
  overlays?: SiteOverlayOption[];
  /** Whether this viewer may add and remove points and areas of interest. */
  canAnnotate?: boolean;
}

function formatCaptureDate(iso: string | null): string {
  if (!iso) return "No capture recorded";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** Label for one option in the capture selector. */
function captureLabel(capture: SiteCaptureOption, isNewest: boolean): string {
  const date = capture.capturedAt
    ? new Date(capture.capturedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "Date not recorded";
  const parts = [date];
  if (isNewest) parts.push("(most recent)");
  if (capture.status !== "READY") parts.push(`- ${capture.status.toLowerCase()}`);
  return parts.join(" ");
}

export function SiteMap({
  token,
  property,
  lastCaptureAt,
  captures,
  selectedCaptureId,
  totalMedia,
  layers,
  overlays = [],
  canAnnotate = false,
}: SiteMapProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("mapbox-gl").Map | null>(null);
  const markersRef = useRef<Map<string, import("mapbox-gl").Marker[]>>(new Map());

  const mappable = useMemo(() => layers.filter((l) => l.mapped && l.markers.length > 0), [layers]);

  // Every placeable layer starts visible: arriving at a site map and seeing
  // an empty site would read as "nothing captured here".
  const [active, setActive] = useState<Set<string>>(() => new Set(mappable.map((l) => l.key)));
  const [ready, setReady] = useState(false);
  // Per-viewer overlay state: what is on, and how see-through. Starts from
  // what the overlay's owner chose as its default.
  const [overlayOn, setOverlayOn] = useState<Set<string>>(() => new Set(overlays.filter((o) => o.isDefault).map((o) => o.id)));
  const [overlayOpacity, setOverlayOpacity] = useState<Record<string, number>>(() =>
    Object.fromEntries(overlays.map((o) => [o.id, o.defaultOpacity])),
  );

  // Drawing a point or area of interest. The mode lives in a ref too, because
  // the map's click handler is bound once when the map loads.
  const [mode, setMode] = useState<DrawMode>(null);
  const modeRef = useRef<DrawMode>(null);
  const [draft, setDraft] = useState<LngLat[]>([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const pointsLayer = layers.find((l) => l.key === "points-of-interest");
  const areasLayer = layers.find((l) => l.key === AREAS_KEY);

  const hasSiteCoords = property.latitude !== null && property.longitude !== null;
  const canRenderMap = !!token && hasSiteCoords;

  useEffect(() => {
    if (!canRenderMap || !containerRef.current) return;
    let cancelled = false;
    const byLayer = markersRef.current;

    import("mapbox-gl").then((mod) => {
      const mapboxgl = mod.default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = token!;

      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [property.longitude!, property.latitude!],
        zoom: 18,
      });
      mapRef.current = map;
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

      map.on("load", () => {
        if (cancelled) return;

        // The site itself, always drawn and never toggled — it is the anchor
        // the capture markers are read against.
        const siteEl = document.createElement("div");
        siteEl.className = "grid place-items-center rounded-full";
        siteEl.style.width = "22px";
        siteEl.style.height = "22px";
        siteEl.style.backgroundColor = "#ffffff";
        siteEl.style.border = "4px solid #0f2340";
        siteEl.style.boxShadow = "0 2px 6px rgba(0,0,0,0.5)";
        new mapboxgl.Marker(siteEl)
          .setLngLat([property.longitude!, property.latitude!])
          .setPopup(new mapboxgl.Popup({ offset: 16 }).setText(property.name))
          .addTo(map);

        // Overlays go under the markers: a plan sheet is the ground the
        // capture pins are read against, not something drawn over them.
        // Every one is added up front, hidden; the effect below shows and
        // fades them without re-adding.
        for (const o of overlays) {
          const url = `/api/v1/overlays/${o.id}/content`;
          if (o.kind === "RASTER" && o.north !== null && o.south !== null && o.east !== null && o.west !== null) {
            map.addSource(overlaySourceId(o.id), {
              type: "image",
              url,
              coordinates: boundsToCorners({ north: o.north, south: o.south, east: o.east, west: o.west }),
            });
            map.addLayer({
              id: `overlay-${o.id}-raster`,
              type: "raster",
              source: overlaySourceId(o.id),
              layout: { visibility: "none" },
              paint: { "raster-opacity": o.defaultOpacity, "raster-fade-duration": 0 },
            });
          } else if (o.kind === "VECTOR") {
            map.addSource(overlaySourceId(o.id), { type: "geojson", data: url });
            map.addLayer({
              id: `overlay-${o.id}-fill`,
              type: "fill",
              source: overlaySourceId(o.id),
              filter: ["==", ["geometry-type"], "Polygon"],
              layout: { visibility: "none" },
              paint: { "fill-color": VECTOR_COLOR, "fill-opacity": o.defaultOpacity * 0.35 },
            });
            map.addLayer({
              id: `overlay-${o.id}-line`,
              type: "line",
              source: overlaySourceId(o.id),
              filter: ["in", ["geometry-type"], ["literal", ["Polygon", "LineString"]]],
              layout: { visibility: "none" },
              paint: { "line-color": VECTOR_COLOR, "line-width": 2, "line-opacity": o.defaultOpacity },
            });
            map.addLayer({
              id: `overlay-${o.id}-point`,
              type: "circle",
              source: overlaySourceId(o.id),
              filter: ["==", ["geometry-type"], "Point"],
              layout: { visibility: "none" },
              paint: { "circle-color": VECTOR_COLOR, "circle-radius": 5, "circle-opacity": o.defaultOpacity },
            });
          }
        }

        // Areas of interest: filled polygons under the pins.
        const areas = layers.find((l) => l.key === AREAS_KEY)?.areas ?? [];
        if (areas.length > 0) {
          map.addSource(AREAS_KEY, {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: areas.map((a) => ({
                type: "Feature" as const,
                properties: { color: a.color },
                geometry: { type: "Polygon" as const, coordinates: [[...a.ring, a.ring[0]]] },
              })),
            },
          });
          map.addLayer({ id: `${AREAS_KEY}-fill`, type: "fill", source: AREAS_KEY, paint: { "fill-color": ["get", "color"], "fill-opacity": 0.25 } });
          map.addLayer({ id: `${AREAS_KEY}-line`, type: "line", source: AREAS_KEY, paint: { "line-color": ["get", "color"], "line-width": 2 } });
        }

        // What is being drawn right now: corners as dots joined by a line.
        map.addSource(DRAFT_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: `${DRAFT_SOURCE}-line`, type: "line", source: DRAFT_SOURCE, paint: { "line-color": "#facc15", "line-width": 2, "line-dasharray": [2, 1] } });
        map.addLayer({
          id: `${DRAFT_SOURCE}-point`,
          type: "circle",
          source: DRAFT_SOURCE,
          paint: { "circle-color": "#facc15", "circle-radius": 5, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
        });
        map.on("click", (e) => {
          const current = modeRef.current;
          if (!current) return;
          const corner: LngLat = [e.lngLat.lng, e.lngLat.lat];
          setDraft((prev) => (current === "POINT" ? [corner] : [...prev, corner]));
        });

        for (const layer of mappable) {
          const created = layer.markers.map((m: SiteMarker) => {
            const el = document.createElement("div");
            el.className = "cursor-pointer";
            el.style.width = "14px";
            el.style.height = "14px";
            el.style.borderRadius = "50%";
            el.style.border = "2px solid #ffffff";
            el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.45)";
            el.style.backgroundColor = layer.color;
            return new mapboxgl.Marker(el)
              .setLngLat([m.longitude, m.latitude])
              .setPopup(new mapboxgl.Popup({ offset: 14 }).setText(`${layer.label} — ${m.label}`))
              .addTo(map);
          });
          byLayer.set(layer.key, created);
        }

        // Frame the site plus everything captured on it. Without the capture
        // markers in the bounds, a photo taken across the car park sits off
        // screen on arrival.
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([property.longitude!, property.latitude!]);
        for (const layer of mappable) for (const m of layer.markers) bounds.extend([m.longitude, m.latitude]);
        map.fitBounds(bounds, { padding: 90, maxZoom: 19, duration: 0 });
        setReady(true);
      });
    });

    return () => {
      cancelled = true;
      byLayer.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // `layers` is read for the areas, which change exactly when `mappable` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRenderMap, token, property.latitude, property.longitude, property.name, mappable, overlays]);

  // Redraw the draft whenever a corner is added.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const source = map.getSource(DRAFT_SOURCE) as import("mapbox-gl").GeoJSONSource | undefined;
    if (!source) return;
    const features: GeoJSON.Feature[] = draft.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }));
    if (mode === "AREA" && draft.length > 1) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: draft.length > 2 ? [...draft, draft[0]] : draft },
      });
    }
    source.setData({ type: "FeatureCollection", features });
    map.getCanvas().style.cursor = mode ? "crosshair" : "";
  }, [draft, mode, ready]);

  function startDrawing(next: DrawMode) {
    setMode(next);
    setDraft([]);
    setDraftTitle("");
    setDraftNotes("");
    setDrawError(null);
  }

  const draftComplete = mode === "POINT" ? draft.length === 1 : mode === "AREA" ? draft.length >= 3 : false;

  async function saveDraft() {
    if (!mode || !draftComplete) return;
    setSaving(true);
    setDrawError(null);
    const body =
      mode === "POINT"
        ? { kind: "POINT", title: draftTitle, description: draftNotes || null, latitude: draft[0][1], longitude: draft[0][0] }
        : { kind: "AREA", title: draftTitle, description: draftNotes || null, polygon: draft };
    const res = await apiRequest(`/api/v1/properties/${property.id}/annotations`, { method: "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (!res.ok) {
      setDrawError(res.error);
      return;
    }
    startDrawing(null);
    router.refresh();
  }

  async function removeAnnotation(id: string, title: string) {
    if (!window.confirm(`Remove "${title}" from the map?`)) return;
    const res = await apiRequest(`/api/v1/annotations/${id}`, { method: "DELETE" });
    if (!res.ok) setDrawError(res.error);
    else router.refresh();
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const o of overlays) {
      const opacity = overlayOpacity[o.id] ?? o.defaultOpacity;
      for (const layerId of overlayLayerIds(o)) {
        if (!map.getLayer(layerId)) continue;
        map.setLayoutProperty(layerId, "visibility", overlayOn.has(o.id) ? "visible" : "none");
        if (layerId.endsWith("-raster")) map.setPaintProperty(layerId, "raster-opacity", opacity);
        else if (layerId.endsWith("-fill")) map.setPaintProperty(layerId, "fill-opacity", opacity * 0.35);
        else if (layerId.endsWith("-line")) map.setPaintProperty(layerId, "line-opacity", opacity);
        else map.setPaintProperty(layerId, "circle-opacity", opacity);
      }
    }
  }, [ready, overlays, overlayOn, overlayOpacity]);

  // Toggling hides markers in place rather than rebuilding them, so the
  // current pan and zoom survive.
  useEffect(() => {
    if (!ready) return;
    for (const [key, markers] of markersRef.current) {
      const visible = active.has(key);
      for (const marker of markers) marker.getElement().style.display = visible ? "" : "none";
    }
    const map = mapRef.current;
    for (const id of [`${AREAS_KEY}-fill`, `${AREAS_KEY}-line`]) {
      if (map?.getLayer(id)) map.setLayoutProperty(id, "visibility", active.has(AREAS_KEY) ? "visible" : "none");
    }
  }, [active, ready]);

  function toggle(key: string) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem-11rem)] min-h-[560px]">
      <div className="relative min-w-0 flex-1 bg-shell">
        {canRenderMap ? (
          <div ref={containerRef} className="h-full w-full" />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="max-w-sm">
              <p className="text-sm font-medium text-white">Site map unavailable</p>
              <p className="mt-1 text-sm text-shell-muted">
                {!token
                  ? "NEXT_PUBLIC_MAPBOX_TOKEN is not set, so the map cannot render."
                  : "This property has no latitude/longitude recorded, so there is nothing to centre the map on."}
              </p>
            </div>
          </div>
        )}

        {/* Floating over the map, top-left — the position the reference
            product gives its capture-date control. */}
        {canRenderMap && captures.length > 0 ? (
          <div className="absolute left-4 top-4 z-10">
            <label className="flex items-center gap-2 rounded-full bg-surface/95 py-1.5 pl-3 pr-1.5 text-sm shadow-lg backdrop-blur">
              <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="4.5" width="14" height="13" rx="2" />
                <path d="M3 8.5h14M7 2.5v4M13 2.5v4" strokeLinecap="round" />
              </svg>
              <span className="sr-only">Capture date</span>
              <select
                value={selectedCaptureId ?? ""}
                onChange={(e) => {
                  // The selection lives in the URL so it survives a reload and
                  // can be linked to. The server re-scopes it to this property.
                  const params = new URLSearchParams(window.location.search);
                  params.set("tab", "site-map");
                  params.set("capture", e.target.value);
                  router.push(`/properties/${property.id}?${params.toString()}`);
                }}
                className="rounded-full bg-transparent py-1 pl-1 pr-2 text-sm font-medium text-foreground outline-none"
              >
                {captures.map((capture, index) => (
                  <option key={capture.id} value={capture.id}>
                    {captureLabel(capture, index === 0)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </div>

      <aside className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface">
        <div className="space-y-3 border-b border-border p-5">
          <h2 className="text-xl font-semibold leading-tight text-foreground">{property.name}</h2>

          {property.customerPropertyId ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M10 18s6-5.2 6-9.5A6 6 0 004 8.5C4 12.8 10 18 10 18z" strokeLinejoin="round" />
                <circle cx="10" cy="8.5" r="2" />
              </svg>
              {property.customerPropertyId}
            </span>
          ) : null}

          <p className="text-sm leading-snug text-muted">
            {property.addressLine1}
            <br />
            {property.city}, {property.state} {property.postalCode}
          </p>

          <p className="text-sm text-muted">
            Last Capture: <span className="text-foreground">{formatCaptureDate(lastCaptureAt)}</span>
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            <span className="rounded-full bg-shell px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
              {totalMedia} media
            </span>
            <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {mappable.length} {mappable.length === 1 ? "layer" : "layers"}
            </span>
          </div>
        </div>

        <div className="p-5">
          <h3 className="text-base font-semibold text-foreground">Media</h3>
          <p className="mt-1 text-sm text-muted">Click a mapped layer to toggle its markers on or off.</p>

          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            {layers.map((layer) => {
              const on = active.has(layer.key);
              const interactive = layer.mapped && layer.markers.length > 0;

              const body = (
                <>
                  <span
                    aria-hidden
                    className="mt-0.5 h-4 w-4 shrink-0 rounded"
                    style={{
                      backgroundColor: interactive && !on ? "transparent" : layer.color,
                      border: `2px solid ${layer.color}`,
                      opacity: layer.count === 0 ? 0.35 : 1,
                    }}
                  />
                  <span className={`min-w-0 text-[13px] leading-snug ${layer.count === 0 ? "text-muted" : "text-foreground"}`}>
                    {layer.label} ({layer.count})
                  </span>
                </>
              );

              if (interactive) {
                return (
                  <button
                    key={layer.key}
                    type="button"
                    onClick={() => toggle(layer.key)}
                    aria-pressed={on}
                    title={`${on ? "Hide" : "Show"} ${layer.markers.length} ${layer.label.toLowerCase()} on the map`}
                    className="flex items-start gap-2 rounded-lg p-1 text-left transition hover:bg-background"
                  >
                    {body}
                  </button>
                );
              }

              // Not placeable: the count is real, the position is not
              // recorded. Link to the tab that owns it rather than offering a
              // toggle that could do nothing.
              return layer.href && layer.count > 0 ? (
                <Link
                  key={layer.key}
                  href={layer.href}
                  title={`${layer.count} ${layer.label.toLowerCase()} — no coordinates recorded, not shown on the map`}
                  className="flex items-start gap-2 rounded-lg p-1 text-left transition hover:bg-background"
                >
                  {body}
                </Link>
              ) : (
                <span key={layer.key} className="flex items-start gap-2 p-1" title="Nothing recorded yet">
                  {body}
                </span>
              );
            })}
          </div>

          <div className="mt-4 flex justify-end">
            <Link
              href={`/properties/${property.id}?tab=media`}
              className="rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              View all media
            </Link>
          </div>

          {canAnnotate || (pointsLayer?.count ?? 0) > 0 || (areasLayer?.count ?? 0) > 0 ? (
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="text-base font-semibold text-foreground">Points &amp; areas of interest</h3>
              {canAnnotate && canRenderMap ? (
                <div className="mt-3 space-y-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startDrawing(mode === "POINT" ? null : "POINT")}
                      aria-pressed={mode === "POINT"}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${mode === "POINT" ? "border-brand text-brand" : "border-border text-foreground hover:bg-background"}`}
                    >
                      + Point
                    </button>
                    <button
                      type="button"
                      onClick={() => startDrawing(mode === "AREA" ? null : "AREA")}
                      aria-pressed={mode === "AREA"}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${mode === "AREA" ? "border-brand text-brand" : "border-border text-foreground hover:bg-background"}`}
                    >
                      + Area
                    </button>
                  </div>
                  {mode ? (
                    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                      <p className="text-xs text-muted">
                        {mode === "POINT"
                          ? draft.length === 0
                            ? "Click the map where the point goes."
                            : "Click again to move it."
                          : `Click the map to add corners (${draft.length} so far, at least 3).`}
                      </p>
                      {mode === "AREA" && draft.length > 0 ? (
                        <button type="button" onClick={() => setDraft((d) => d.slice(0, -1))} className="text-xs text-brand hover:underline">
                          Undo last corner
                        </button>
                      ) : null}
                      <input
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        placeholder={mode === "POINT" ? "Title, e.g. Roof hatch" : "Title, e.g. Staging area"}
                        className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                      />
                      <textarea
                        value={draftNotes}
                        onChange={(e) => setDraftNotes(e.target.value)}
                        placeholder="Notes (optional)"
                        rows={2}
                        className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                      />
                      {drawError ? <p className="text-xs text-[var(--band-critical)]">{drawError}</p> : null}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={!draftComplete || !draftTitle.trim() || saving}
                          onClick={saveDraft}
                          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                        >
                          {saving ? "Saving…" : "Save"}
                        </button>
                        <button type="button" onClick={() => startDrawing(null)} className="rounded-lg border border-border px-3 py-1.5 text-sm">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!mode && drawError ? <p className="mt-2 text-xs text-[var(--band-critical)]">{drawError}</p> : null}
              <ul className="mt-3 space-y-1.5">
                {[
                  ...(pointsLayer?.markers ?? []).map((m) => ({ id: m.id, title: m.label, kind: "Point" })),
                  ...(areasLayer?.areas ?? []).map((a) => ({ id: a.id, title: a.label, kind: "Area" })),
                ].map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-foreground">
                      {a.title} <span className="text-xs text-muted">· {a.kind}</span>
                    </span>
                    {canAnnotate ? (
                      <button type="button" onClick={() => removeAnnotation(a.id, a.title)} className="text-xs text-muted hover:text-[var(--band-critical)]">
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {overlays.length > 0 ? (
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="text-base font-semibold text-foreground">Overlays</h3>
              {(["RASTER", "VECTOR"] as const).map((kind) => {
                const group = overlays.filter((o) => o.kind === kind);
                if (group.length === 0) return null;
                return (
                  <div key={kind} className="mt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                      {kind === "RASTER" ? "Raster overlays" : "Vector overlays"} ({group.length})
                    </p>
                    <ul className="mt-2 space-y-3">
                      {group.map((o) => (
                        <li key={o.id} className="space-y-1">
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            <input
                              type="checkbox"
                              disabled={!canRenderMap}
                              checked={overlayOn.has(o.id)}
                              onChange={() =>
                                setOverlayOn((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(o.id)) next.delete(o.id);
                                  else next.add(o.id);
                                  return next;
                                })
                              }
                            />
                            <span className="min-w-0 flex-1 truncate">{o.name}</span>
                            <span className="text-xs text-muted">{o.categoryLabel}</span>
                          </label>
                          {canRenderMap && overlayOn.has(o.id) ? (
                            <label className="flex items-center gap-2 pl-6 text-xs text-muted">
                              Opacity
                              <input
                                type="range"
                                min={0}
                                max={100}
                                value={Math.round((overlayOpacity[o.id] ?? o.defaultOpacity) * 100)}
                                onChange={(e) => setOverlayOpacity((prev) => ({ ...prev, [o.id]: Number(e.target.value) / 100 }))}
                                className="flex-1"
                                aria-label={`${o.name} opacity`}
                              />
                              <span className="w-8 tabular-nums">{Math.round((overlayOpacity[o.id] ?? o.defaultOpacity) * 100)}%</span>
                            </label>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : null}

          <p className="mt-4 space-y-2 border-t border-border pt-3 text-xs leading-relaxed text-muted">
            Flight imagery, drone 3D models, point clouds and orthomosaics are counted for the selected capture. Evidence,
            assets, issues, assessments and documents belong to the property rather than to a flight, so they do not
            change when you switch capture dates.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            HD images, project photos and videos, 360 images, and the points and areas drawn here carry coordinates, so
            only those are placed on the map. Everything else is counted here and opens in its own tab.
          </p>
        </div>
      </aside>
    </div>
  );
}
