"use client";

import { useState } from "react";
import { Panorama360Walk } from "@/components/media/Panorama360Walk";

export interface Delivered360View {
  id: string;
  label: string;
  /** Formatted for display. */
  capturedAt: string | null;
  capturedAtIso: string | null;
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  imageUrls: string[];
  thumbnailUrl: string;
}

/**
 * 360° photos delivered on a job site — Insta360 imports and uploaded
 * panoramas — viewable in place, so the vendor sees what they handed over and
 * the platform team can look around each one before approving.
 */
export function Delivered360Views({ views, canSetNorth = false }: { views: Delivered360View[]; canSetNorth?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (views.length === 0) return null;
  const current = views.find((v) => v.id === selected) ?? views[0];

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">360° views delivered ({views.length})</p>
      <div className="h-96 overflow-hidden rounded-lg border border-border">
        <Panorama360Walk
          panoramas={views.map((v) => ({ ...v, capturedAt: v.capturedAtIso }))}
          selectedId={current.id}
          onSelect={setSelected}
          canSetNorth={canSetNorth}
        />
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {views.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => setSelected(v.id)}
              aria-pressed={v.id === current.id}
              className={`block w-full overflow-hidden rounded-lg border-2 text-left ${
                v.id === current.id ? "border-brand" : "border-transparent hover:border-border"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated API route, not a static asset */}
              <img src={v.thumbnailUrl} alt="" loading="lazy" className="aspect-[2/1] w-full object-cover" />
              <span className="block truncate px-1.5 py-1 text-xs text-muted">
                {v.label}
                {v.capturedAt ? ` · ${v.capturedAt}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
