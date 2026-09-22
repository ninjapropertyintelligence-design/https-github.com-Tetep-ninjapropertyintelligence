"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "mapbox-gl/dist/mapbox-gl.css";
import type { SiteLayer, SiteMarker } from "@/lib/site-map";

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
  }, [canRenderMap, token, property.latitude, property.longitude, property.name, mappable]);

  // Toggling hides markers in place rather than rebuilding them, so the
  // current pan and zoom survive.
  useEffect(() => {
    if (!ready) return;
    for (const [key, markers] of markersRef.current) {
      const visible = active.has(key);
      for (const marker of markers) marker.getElement().style.display = visible ? "" : "none";
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

          <p className="mt-4 space-y-2 border-t border-border pt-3 text-xs leading-relaxed text-muted">
            Drone photos, 3D models, point clouds and orthomosaics are counted for the selected capture. Evidence,
            assets, issues, assessments and documents belong to the property rather than to a flight, so they do not
            change when you switch capture dates.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Only drone photos and evidence photos carry coordinates in this schema, so only those can be placed on the
            map. Everything else is counted here and opens in its own tab.
          </p>
        </div>
      </aside>
    </div>
  );
}
