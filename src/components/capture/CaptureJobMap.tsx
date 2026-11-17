"use client";

import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";

export interface JobMapSite {
  id: string;
  name: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  /** Where the job wants each shot taken, when the position has been pinned. */
  shots: Array<{ id: string; label: string; sequence: number; captured: boolean; latitude: number | null; longitude: number | null }>;
  /** Where the uploaded photos were actually taken, from their GPS. */
  photos: Array<{ id: string; latitude: number; longitude: number }>;
}

const STATUS_COLOR: Record<string, string> = {
  PENDING: "#5b6472",
  IN_PROGRESS: "#d99a12",
  SUBMITTED: "#2563eb",
  ACCEPTED: "#1a9c5c",
  REJECTED: "#d0342c",
};

function dot(color: string, size: number, text?: string) {
  const el = document.createElement("div");
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "9999px",
    background: color,
    border: "2px solid white",
    boxShadow: "0 1px 3px rgba(0,0,0,.4)",
    color: "white",
    fontSize: "10px",
    fontWeight: "700",
    display: "grid",
    placeItems: "center",
  });
  if (text) el.textContent = text;
  return el;
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * The job on a satellite map: every site, every pinned shot position (green
 * once captured), and where each uploaded photo was really taken.
 *
 * For the vendor it is where to go and what is left; for the platform team
 * reviewing the work, it shows at a glance whether the photos were taken at
 * the site and at the positions asked for.
 */
export function CaptureJobMap({
  token,
  sites,
  directions = true,
}: {
  token: string | null;
  sites: JobMapSite[];
  /** A directions link per site — for the job page, not an overview of many. */
  directions?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const placed = sites.filter((s) => s.latitude !== null && s.longitude !== null);

  useEffect(() => {
    if (!token || placed.length === 0 || !container.current) return;
    let map: import("mapbox-gl").Map | null = null;
    let cancelled = false;
    import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (cancelled || !container.current) return;
      mapboxgl.accessToken = token;
      map = new mapboxgl.Map({
        container: container.current,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [placed[0].longitude!, placed[0].latitude!],
        zoom: 16,
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

      const bounds = new mapboxgl.LngLatBounds();
      for (const site of placed) {
        const point: [number, number] = [site.longitude!, site.latitude!];
        bounds.extend(point);
        new mapboxgl.Marker({ element: dot(STATUS_COLOR[site.status] ?? "#5b6472", 22) })
          .setLngLat(point)
          .setPopup(
            new mapboxgl.Popup({ offset: 14 }).setHTML(
              `<strong>${escapeHtml(site.name)}</strong><br/>${escapeHtml(site.status.replace(/_/g, " ").toLowerCase())}`,
            ),
          )
          .addTo(map);
        for (const shot of site.shots) {
          if (shot.latitude === null || shot.longitude === null) continue;
          bounds.extend([shot.longitude, shot.latitude]);
          new mapboxgl.Marker({ element: dot(shot.captured ? "#1a9c5c" : "#f59e0b", 18, String(shot.sequence)) })
            .setLngLat([shot.longitude, shot.latitude])
            .setPopup(
              new mapboxgl.Popup({ offset: 12 }).setHTML(
                `${escapeHtml(shot.label)}<br/>${shot.captured ? "captured" : "still to capture"}`,
              ),
            )
            .addTo(map);
        }
        for (const photo of site.photos) {
          bounds.extend([photo.longitude, photo.latitude]);
          new mapboxgl.Marker({ element: dot("#a855f7", 10) }).setLngLat([photo.longitude, photo.latitude]).addTo(map);
        }
      }
      if (placed.length > 1 || placed.some((s) => s.shots.some((x) => x.latitude !== null) || s.photos.length > 0)) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 18, duration: 0 });
      }
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
    // The sites are server data for this render; a refresh remounts the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (placed.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {token ? (
        <div ref={container} className="h-80 w-full" />
      ) : (
        <p className="px-4 py-3 text-sm text-muted">
          The map needs a Mapbox token: set NEXT_PUBLIC_MAPBOX_TOKEN in the hosting settings.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted">
        <Legend color="#5b6472" label="Site" />
        <Legend color="#f59e0b" label="Shot still to capture" />
        <Legend color="#1a9c5c" label="Captured / approved" />
        <Legend color="#a855f7" label="Where a photo was taken" />
        <span className="ml-auto flex flex-wrap gap-3">
          {(directions ? placed : []).map((s) => (
            <a
              key={s.id}
              href={`https://www.google.com/maps/dir/?api=1&destination=${s.latitude},${s.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand hover:underline"
            >
              Directions to {s.name} ↗
            </a>
          ))}
        </span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
