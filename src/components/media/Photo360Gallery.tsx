"use client";

import { useState } from "react";
import { Photo360Viewer } from "@/components/media/Photo360Viewer";

/** Serialised across the server/client boundary — a Date does not survive it. */
export interface Panorama360Option {
  id: string;
  label: string;
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  imageUrl: string;
}

/**
 * The 360 tab: one panorama shown large, the rest listed beside it.
 *
 * The list carries each panorama's date and whether it was geotagged, because
 * those are the two things that decide what a panorama is good for — comparing
 * a location over time, and finding it again on the Site Map.
 */
export function Photo360Gallery({
  panoramas,
  enabled,
}: {
  panoramas: Panorama360Option[];
  /** Whether the org can capture NEW panoramas. Existing ones always render. */
  enabled: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(panoramas[0]?.id ?? null);
  const selected = panoramas.find((p) => p.id === selectedId) ?? panoramas[0] ?? null;

  if (panoramas.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <h2 className="text-base font-semibold text-foreground">No 360° panoramas yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          {enabled
            ? "Upload an equirectangular JPEG from a 360 camera as evidence on this property and it will appear here."
            : "360° panorama capture is not enabled for your organization. Contact your administrator to add it to your plan."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!enabled ? (
        // Panoramas captured while entitled stay viewable. Saying so is the
        // difference between a lapsed plan and apparently lost data.
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          360° panorama capture is no longer enabled for your organization. The {panoramas.length}{" "}
          {panoramas.length === 1 ? "panorama" : "panoramas"} already captured here remain viewable; new ones cannot be
          uploaded.
        </p>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="h-[560px] min-w-0 flex-1">
          {selected ? <Photo360Viewer imageUrl={selected.imageUrl} label={selected.label} /> : null}
        </div>

        <ul className="w-full shrink-0 space-y-2 lg:w-[300px]">
          {panoramas.map((panorama) => {
            const active = panorama.id === selected?.id;
            return (
              <li key={panorama.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(panorama.id)}
                  aria-current={active ? "true" : undefined}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                    active ? "border-brand bg-background" : "border-border hover:bg-background"
                  }`}
                >
                  <p className="truncate text-sm font-medium text-foreground">{panorama.label}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {panorama.capturedAt
                      ? new Date(panorama.capturedAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "Date not recorded"}
                    {panorama.latitude !== null && panorama.longitude !== null ? " · on the site map" : ""}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
