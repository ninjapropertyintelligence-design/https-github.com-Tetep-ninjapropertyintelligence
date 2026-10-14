"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "mapbox-gl/dist/mapbox-gl.css";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { parseLatLng } from "@/lib/capture/shot-matching";

/**
 * Where each position on a site's route is, for staff.
 *
 * Pins are what let imported 360s be matched to positions by GPS. Two ways
 * to set them, because a map is not always available:
 *   - on the satellite map (when a Mapbox token is configured and the site
 *     has coordinates): pick a position, click where it is, drag to adjust;
 *   - by pasting "latitude, longitude", which is exactly what Google Maps
 *     copies when you right-click a spot.
 *
 * Most routes never need this screen after the first visit: new jobs inherit
 * pins by position name, and an unpinned position takes the location of the
 * first geotagged photo filed against it.
 */

export interface PinShot {
  id: string;
  label: string;
  sequence: number;
  latitude: number | null;
  longitude: number | null;
}

type Point = { latitude: number; longitude: number } | null;

const format = (p: Point) => (p ? `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}` : "");

export function ShotPinEditor({
  jobId,
  siteId,
  shots,
  site,
  token,
}: {
  jobId: string;
  siteId: string;
  shots: PinShot[];
  site: { name: string; latitude: number | null; longitude: number | null };
  token: string | null;
}) {
  const router = useRouter();
  const [points, setPoints] = useState<Record<string, Point>>(() =>
    Object.fromEntries(
      shots.map((s) => [s.id, s.latitude !== null && s.longitude !== null ? { latitude: s.latitude, longitude: s.longitude } : null]),
    ),
  );
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(shots.map((s) => [s.id, format(s.latitude !== null && s.longitude !== null ? { latitude: s.latitude, longitude: s.longitude } : null)])),
  );
  const [placing, setPlacing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("mapbox-gl").Map | null>(null);
  const markersRef = useRef<Map<string, import("mapbox-gl").Marker>>(new Map());
  const mapboxRef = useRef<typeof import("mapbox-gl").default | null>(null);
  // Read by the map's click handler, which is bound once when the map loads.
  const placingRef = useRef<string | null>(null);
  useEffect(() => {
    placingRef.current = placing;
  }, [placing]);

  const canMap = !!token && site.latitude !== null && site.longitude !== null;

  function setPoint(shotId: string, point: Point) {
    setPoints((prev) => ({ ...prev, [shotId]: point }));
    setTexts((prev) => ({ ...prev, [shotId]: format(point) }));
    setSaved(false);
  }

  // The map is created once; markers are synced from `points` below.
  useEffect(() => {
    if (!canMap || !containerRef.current) return;
    let cancelled = false;
    const markers = markersRef.current;
    import("mapbox-gl").then((mod) => {
      const mapboxgl = mod.default;
      if (cancelled || !containerRef.current) return;
      mapboxRef.current = mapboxgl;
      mapboxgl.accessToken = token!;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [site.longitude!, site.latitude!],
        zoom: 18,
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("click", (e) => {
        const target = placingRef.current;
        if (!target) return;
        setPoint(target, { latitude: e.lngLat.lat, longitude: e.lngLat.lng });
        setPlacing(null);
      });
      map.on("load", () => {
        if (!cancelled) mapRef.current = map;
        setPoints((p) => ({ ...p })); // trigger the marker sync once the map is ready
      });
    });
    return () => {
      cancelled = true;
      markers.forEach((m) => m.remove());
      markers.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [canMap, token, site.latitude, site.longitude]);

  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapboxRef.current;
    if (!map || !mapboxgl) return;
    for (const shot of shots) {
      const point = points[shot.id];
      let marker = markersRef.current.get(shot.id);
      if (!point) {
        marker?.remove();
        markersRef.current.delete(shot.id);
        continue;
      }
      if (!marker) {
        const el = document.createElement("div");
        el.textContent = String(shot.sequence);
        el.title = shot.label;
        Object.assign(el.style, {
          width: "24px",
          height: "24px",
          borderRadius: "50%",
          background: "#2563eb",
          color: "#fff",
          border: "2px solid #fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
          display: "grid",
          placeItems: "center",
          font: "600 12px system-ui, sans-serif",
          cursor: "grab",
        });
        marker = new mapboxgl.Marker({ element: el, draggable: true }).setLngLat([point.longitude, point.latitude]).addTo(map);
        marker.on("dragend", () => {
          const at = marker!.getLngLat();
          setPoint(shot.id, { latitude: at.lat, longitude: at.lng });
        });
        markersRef.current.set(shot.id, marker);
      } else {
        marker.setLngLat([point.longitude, point.latitude]);
      }
    }
  }, [points, shots]);

  const changed = shots.filter((s) => {
    const p = points[s.id];
    const before = s.latitude !== null && s.longitude !== null ? { latitude: s.latitude, longitude: s.longitude } : null;
    if (!p || !before) return p !== before;
    return Math.abs(p.latitude - before.latitude) > 1e-9 || Math.abs(p.longitude - before.longitude) > 1e-9;
  });
  const invalid = shots.filter((s) => parseLatLng(texts[s.id] ?? "") === "invalid");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/capture-jobs/${jobId}/sites/${siteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "shot-locations",
          locations: changed.map((s) => ({
            shotId: s.id,
            latitude: points[s.id]?.latitude ?? null,
            longitude: points[s.id]?.longitude ?? null,
          })),
        }),
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save the positions");
    } finally {
      setBusy(false);
    }
  }

  const pinnedCount = shots.filter((s) => points[s.id]).length;

  return (
    <details className="mt-3 rounded-lg border border-border bg-background">
      <summary className="cursor-pointer px-3 py-2 text-sm text-foreground">
        Shot positions on the map{" "}
        <span className="text-xs text-muted">
          ({pinnedCount} of {shots.length} placed — placed positions let 360 imports match photos by GPS)
        </span>
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        {canMap ? (
          <div className="relative">
            <div ref={containerRef} className="h-80 w-full overflow-hidden rounded-lg" />
            {placing ? (
              <p className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-medium text-foreground shadow">
                Click the map where &ldquo;{shots.find((s) => s.id === placing)?.label}&rdquo; is
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted">
            {!token
              ? "The map needs NEXT_PUBLIC_MAPBOX_TOKEN. Until then, paste coordinates: in Google Maps, right-click the spot and click the numbers to copy them."
              : "This site has no coordinates to centre a map on. Paste coordinates for each position instead."}
          </p>
        )}

        <ol className="space-y-1.5">
          {shots.map((shot) => (
            <li key={shot.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-6 shrink-0 text-right text-xs text-muted">{shot.sequence}.</span>
              <span className="w-40 shrink-0 truncate text-foreground">{shot.label}</span>
              <input
                value={texts[shot.id] ?? ""}
                onChange={(e) => {
                  const text = e.target.value;
                  setTexts((prev) => ({ ...prev, [shot.id]: text }));
                  const parsed = parseLatLng(text);
                  if (parsed !== "invalid") setPoints((prev) => ({ ...prev, [shot.id]: parsed }));
                  setSaved(false);
                }}
                placeholder="latitude, longitude"
                aria-label={`Coordinates for ${shot.label}`}
                className={`w-56 rounded border px-2 py-1 font-mono text-xs ${
                  parseLatLng(texts[shot.id] ?? "") === "invalid" ? "border-red-400" : "border-border"
                }`}
              />
              {canMap ? (
                <button
                  type="button"
                  onClick={() => setPlacing(placing === shot.id ? null : shot.id)}
                  className={`rounded border px-2 py-1 text-xs ${placing === shot.id ? "border-brand bg-brand text-white" : "border-border text-foreground"}`}
                >
                  {placing === shot.id ? "Click the map…" : points[shot.id] ? "Move" : "Place"}
                </button>
              ) : null}
              {points[shot.id] ? (
                <button type="button" onClick={() => setPoint(shot.id, null)} className="text-xs text-muted underline">
                  Clear
                </button>
              ) : null}
            </li>
          ))}
        </ol>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy || changed.length === 0 || invalid.length > 0}
            onClick={save}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : `Save positions${changed.length ? ` (${changed.length})` : ""}`}
          </button>
          {invalid.length > 0 ? <span className="text-xs text-red-600">Fix the coordinates outlined in red.</span> : null}
          {saved ? <span className="text-xs text-[var(--band-good)]">Saved.</span> : null}
          {error ? <span className="text-xs text-red-600">{error}</span> : null}
        </div>
      </div>
    </details>
  );
}
