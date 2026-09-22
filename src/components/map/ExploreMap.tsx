"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "mapbox-gl/dist/mapbox-gl.css";

export interface MapProperty {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  propertyType: string;
  regionName: string | null;
  band: string | null;
  healthScore: number | null;
}

const BAND_COLOR: Record<string, string> = {
  Excellent: "#1a9c5c",
  Good: "#4c9c1a",
  "Needs Attention": "#d99a12",
  Poor: "#e2691a",
  Critical: "#d0342c",
};

const NO_DATA_COLOR = "#5b6472";

/** Order matters: the filter dropdown reads worst-first, which is the order an operator cares about. */
const BANDS = ["Critical", "Poor", "Needs Attention", "Good", "Excellent"] as const;

function colorFor(band: string | null): string {
  return band ? (BAND_COLOR[band] ?? NO_DATA_COLOR) : NO_DATA_COLOR;
}

function matches(p: MapProperty, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return (
    p.name.toLowerCase().includes(q) ||
    p.addressLine1.toLowerCase().includes(q) ||
    p.city.toLowerCase().includes(q) ||
    p.state.toLowerCase().includes(q) ||
    p.postalCode.toLowerCase().includes(q) ||
    (p.regionName?.toLowerCase().includes(q) ?? false)
  );
}

/**
 * Builds the marker popup as real DOM rather than an HTML string, so the
 * "Explore" action can be a click handler that routes instead of a full page
 * load — and so a property name containing markup characters is set as text
 * and cannot inject anything.
 */
function buildPopupContent(p: MapProperty, onExplore: (id: string) => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "w-[248px] font-sans";

  const banner = document.createElement("div");
  banner.className = "flex h-[92px] items-center justify-center";
  banner.style.backgroundColor = colorFor(p.band);
  const score = document.createElement("div");
  score.className = "text-center leading-tight text-white";
  const scoreValue = document.createElement("p");
  scoreValue.className = "text-3xl font-semibold";
  scoreValue.textContent = p.healthScore !== null ? p.healthScore.toFixed(1) : "—";
  const scoreLabel = document.createElement("p");
  scoreLabel.className = "text-[11px] uppercase tracking-wide opacity-90";
  scoreLabel.textContent = p.band ?? "No health data";
  score.append(scoreValue, scoreLabel);
  banner.append(score);

  const body = document.createElement("div");
  body.className = "space-y-2 px-4 py-3";

  const name = document.createElement("p");
  name.className = "text-[15px] font-semibold text-foreground";
  name.textContent = p.name;

  const address = document.createElement("p");
  address.className = "text-[13px] leading-snug text-muted";
  address.textContent = `${p.addressLine1}\n${p.city}, ${p.state} ${p.postalCode}`;
  address.style.whiteSpace = "pre-line";

  const explore = document.createElement("button");
  explore.type = "button";
  explore.className =
    "w-full rounded-full bg-brand px-4 py-1.5 text-[13px] font-medium text-brand-foreground transition hover:opacity-90";
  explore.textContent = "Explore";
  explore.addEventListener("click", () => onExplore(p.id));

  body.append(name, address, explore);
  root.append(banner, body);
  return root;
}

export function ExploreMap({ properties, token }: { properties: MapProperty[]; token: string }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("mapbox-gl").Map | null>(null);
  const markersRef = useRef<Map<string, import("mapbox-gl").Marker>>(new Map());
  // Held in a ref so the map effect below does not list `router` as a
  // dependency: a new router identity would otherwise tear down and rebuild
  // the whole map. Assigned in an effect, never during render.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const [query, setQuery] = useState("");
  const [band, setBand] = useState<string>("all");
  const [panelOpen, setPanelOpen] = useState(true);
  const [ready, setReady] = useState(false);

  const visible = useMemo(
    () => properties.filter((p) => matches(p, query) && (band === "all" || p.band === band)),
    [properties, query, band],
  );
  const visibleIds = useMemo(() => new Set(visible.map((p) => p.id)), [visible]);

  // One map instance for the component's lifetime. Filtering hides and shows
  // existing markers rather than tearing the map down, so panning and zoom
  // survive a search — rebuilding on every keystroke would reset the view.
  useEffect(() => {
    if (!containerRef.current || properties.length === 0) return;
    let cancelled = false;
    const markers = markersRef.current;

    import("mapbox-gl").then((mod) => {
      const mapboxgl = mod.default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = token;

      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [properties[0].longitude, properties[0].latitude],
        zoom: 4,
        attributionControl: true,
      });
      mapRef.current = map;
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

      map.on("load", () => {
        if (cancelled) return;
        for (const p of properties) {
          const el = document.createElement("div");
          el.className = "cursor-pointer";
          el.style.width = "18px";
          el.style.height = "18px";
          el.style.borderRadius = "50%";
          el.style.border = "3px solid #ffffff";
          el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.45)";
          el.style.backgroundColor = colorFor(p.band);

          const popup = new mapboxgl.Popup({ offset: 16, closeButton: true, maxWidth: "248px" }).setDOMContent(
            buildPopupContent(p, (id) => routerRef.current.push(`/properties/${id}`)),
          );

          markers.set(p.id, new mapboxgl.Marker(el).setLngLat([p.longitude, p.latitude]).setPopup(popup).addTo(map));
        }

        // Frame the whole portfolio rather than guessing a zoom level — a
        // single property and a national portfolio need very different views.
        const bounds = new mapboxgl.LngLatBounds();
        for (const p of properties) bounds.extend([p.longitude, p.latitude]);
        map.fitBounds(bounds, { padding: { top: 80, bottom: 80, left: 80, right: 420 }, maxZoom: 14, duration: 0 });
        setReady(true);
      });
    });

    return () => {
      cancelled = true;
      markers.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [properties, token]);

  // Filtering toggles marker visibility on the element the marker already owns.
  useEffect(() => {
    if (!ready) return;
    for (const [id, marker] of markersRef.current) {
      marker.getElement().style.display = visibleIds.has(id) ? "" : "none";
    }
  }, [visibleIds, ready]);

  function focus(p: MapProperty) {
    const map = mapRef.current;
    const marker = markersRef.current.get(p.id);
    if (!map || !marker) return;
    map.flyTo({ center: [p.longitude, p.latitude], zoom: Math.max(map.getZoom(), 13), duration: 900 });
    if (!marker.getPopup()?.isOpen()) marker.togglePopup();
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />

      {/* Floating results panel. Positioned over the map rather than docked
          beside it, so the map stays full-bleed at every breakpoint. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 flex max-w-full items-start p-4">
        <div className="pointer-events-auto flex max-h-full items-start gap-2">
          <button
            type="button"
            onClick={() => setPanelOpen((o) => !o)}
            aria-label={panelOpen ? "Hide locations panel" : "Show locations panel"}
            className="mt-2 rounded-lg bg-surface/95 p-2 text-muted shadow-lg backdrop-blur transition hover:text-foreground"
          >
            <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${panelOpen ? "" : "rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {panelOpen ? (
            <div className="flex max-h-full w-[320px] flex-col overflow-hidden rounded-2xl bg-surface/95 shadow-2xl backdrop-blur">
              <div className="space-y-3 border-b border-border p-4">
                <div className="relative">
                  <svg viewBox="0 0 20 20" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="9" cy="9" r="6" />
                    <path d="M14 14l4 4" strokeLinecap="round" />
                  </svg>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search locations"
                    className="w-full rounded-full border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-brand"
                  />
                </div>

                <p className="text-sm text-muted">
                  Showing <span className="font-semibold text-foreground">{visible.length}</span>{" "}
                  {visible.length === 1 ? "location" : "locations"}
                  {visible.length !== properties.length ? <span className="text-muted"> of {properties.length}</span> : null}
                </p>

                <select
                  value={band}
                  onChange={(e) => setBand(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
                >
                  <option value="all">Health filter — all bands</option>
                  {BANDS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {visible.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted">No locations match this search.</p>
                ) : (
                  visible.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => focus(p)}
                      className="flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition last:border-0 hover:bg-background"
                    >
                      <span
                        aria-hidden
                        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: colorFor(p.band) }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold text-foreground">{p.name}</span>
                        <span className="block text-[13px] leading-snug text-muted">
                          {p.addressLine1}
                          <br />
                          {p.city}, {p.state} {p.postalCode}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
