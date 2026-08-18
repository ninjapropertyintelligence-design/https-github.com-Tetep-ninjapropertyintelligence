"use client";

import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";

export interface MapProperty {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
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

export function PortfolioMap({ properties, token }: { properties: MapProperty[]; token: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || properties.length === 0) return;
    let map: import("mapbox-gl").Map | undefined;
    let cancelled = false;

    import("mapbox-gl").then((mapboxgl) => {
      if (cancelled || !containerRef.current) return;
      mapboxgl.default.accessToken = token;
      map = new mapboxgl.default.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/light-v11",
        center: [properties[0].longitude, properties[0].latitude],
        zoom: 3,
      });
      map.addControl(new mapboxgl.default.NavigationControl(), "top-right");

      map.on("load", () => {
        for (const p of properties) {
          const el = document.createElement("div");
          el.style.width = "14px";
          el.style.height = "14px";
          el.style.borderRadius = "50%";
          el.style.border = "2px solid white";
          el.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.15)";
          el.style.backgroundColor = p.band ? BAND_COLOR[p.band] ?? "#5b6472" : "#5b6472";
          el.style.cursor = "pointer";

          const popup = new mapboxgl.default.Popup({ offset: 12 }).setHTML(
            `<div style="font-size:13px"><strong>${p.name}</strong><br/>Health: ${p.healthScore ?? "—"} (${p.band ?? "no data"})<br/><a href="/properties/${p.id}" style="color:#2453ff">Open property →</a></div>`,
          );

          new mapboxgl.default.Marker(el).setLngLat([p.longitude, p.latitude]).setPopup(popup).addTo(map!);
        }
      });
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [properties, token]);

  return <div ref={containerRef} className="h-[600px] w-full rounded-xl border border-border" />;
}
