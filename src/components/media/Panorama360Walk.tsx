"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { apiRequest } from "@/components/settings/api-request";
import { effectiveHeadings, panoramaLinks, type NavPanorama } from "@/lib/media/panorama-navigation";

const Photo360Viewer = dynamic(() => import("@/components/media/Photo360Viewer").then((m) => m.Photo360Viewer), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted">Loading viewer…</p>,
});

export interface WalkPanorama extends NavPanorama {
  imageUrls: string[];
}

/**
 * A set of 360 panoramas as one walk: the selected one in the viewer, arrows
 * on the ground towards the others nearby, and previous / next in capture
 * order. Headings that were never recorded are estimated from the direction
 * of travel; anyone who may edit can correct one by facing north.
 */
export function Panorama360Walk({
  panoramas,
  selectedId,
  onSelect,
  canSetNorth = false,
}: {
  panoramas: WalkPanorama[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  canSetNorth?: boolean;
}) {
  // Headings set here take effect at once, before the page is refreshed.
  const [setHeadings, setSetHeadings] = useState<Record<string, number>>({});
  const [arrivalBearing, setArrivalBearing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const withSet = useMemo(
    () => panoramas.map((p) => (setHeadings[p.id] !== undefined ? { ...p, heading: setHeadings[p.id] } : p)),
    [panoramas, setHeadings],
  );
  const headings = useMemo(() => effectiveHeadings(withSet), [withSet]);
  const ordered = useMemo(
    () => withSet.slice().sort((a, b) => (a.capturedAt ?? "").localeCompare(b.capturedAt ?? "")),
    [withSet],
  );
  const current = withSet.find((p) => p.id === selectedId) ?? withSet[0] ?? null;
  if (!current) return null;
  const links = panoramaLinks(current, withSet);
  const heading = headings.get(current.id) ?? null;
  const position = ordered.findIndex((p) => p.id === current.id);

  function go(id: string, bearing: number | null) {
    setArrivalBearing(bearing);
    setError(null);
    onSelect(id);
  }

  async function setNorth(newHeading: number) {
    const res = await apiRequest(`/api/v1/evidence/${current!.id}/heading`, {
      method: "PUT",
      body: JSON.stringify({ heading: newHeading }),
    });
    if (!res.ok) setError(res.error);
    else setSetHeadings((prev) => ({ ...prev, [current!.id]: newHeading }));
  }

  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="min-h-72 flex-1">
        <Photo360Viewer
          key={current.id}
          imageUrls={current.imageUrls}
          label={current.label}
          heading={heading?.heading ?? null}
          links={links}
          initialBearing={arrivalBearing}
          onNavigate={(id, bearing) => go(id, bearing)}
          onPrev={position > 0 ? () => go(ordered[position - 1].id, null) : undefined}
          onNext={position >= 0 && position < ordered.length - 1 ? () => go(ordered[position + 1].id, null) : undefined}
          onSetNorth={canSetNorth ? setNorth : undefined}
        />
      </div>
      {error ? <p className="text-xs text-[var(--band-critical)]">{error}</p> : null}
      {heading?.estimated && links.length > 0 ? (
        <p className="text-xs text-muted">
          Arrow directions are estimated from the walking direction.
          {canSetNorth ? " If they look off, turn to face north and press “This view faces north”." : ""}
        </p>
      ) : null}
      {current.latitude === null ? <p className="text-xs text-muted">This panorama has no GPS position, so it has no walking arrows.</p> : null}
    </div>
  );
}
