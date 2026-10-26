"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const Photo360Viewer = dynamic(() => import("@/components/media/Photo360Viewer").then((m) => m.Photo360Viewer), {
  ssr: false,
  loading: () => <p className="text-sm text-muted">Loading viewer…</p>,
});

export interface Delivered360View {
  id: string;
  label: string;
  capturedAt: string | null;
  imageUrl: string;
}

/**
 * 360° photos delivered on a job site — Insta360 imports and uploaded
 * panoramas — viewable in place, so the vendor sees what they handed over and
 * the platform team can look around each one before approving.
 */
export function Delivered360Views({ views }: { views: Delivered360View[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (views.length === 0) return null;
  const current = views.find((v) => v.id === selected) ?? views[0];

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">360° views delivered ({views.length})</p>
      <div className="h-80 overflow-hidden rounded-lg border border-border">
        <Photo360Viewer key={current.id} imageUrl={current.imageUrl} label={current.label} />
      </div>
      {views.length > 1 ? (
        <ul className="flex flex-wrap gap-2">
          {views.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => setSelected(v.id)}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  v.id === current.id ? "border-brand text-brand" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {v.label}
                {v.capturedAt ? ` · ${v.capturedAt}` : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
