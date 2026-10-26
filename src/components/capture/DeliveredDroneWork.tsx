"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { isViewableIn3D } from "@/components/exterior/Object3DViewer";
import { OUTPUT_LABELS, displayFilename, isBrowserImage } from "@/lib/drone-display";
import { DroneMapViewer, type DroneMapLayer } from "@/components/drone/DroneMapViewer";

const Object3DViewer = dynamic(() => import("@/components/exterior/Object3DViewer").then((m) => m.Object3DViewer), {
  ssr: false,
  loading: () => <p className="text-sm text-muted">Loading viewer…</p>,
});

export interface DeliveredDroneCapture {
  id: string;
  status: string;
  notes: string | null;
  outputs: Array<{ id: string; outputType: string; storageKey: string; downloadUrl: string; preview: boolean }>;
  images: Array<{ id: string; thumbnailUrl: string; previewUrl: string; originalUrl: string }>;
  imageCount: number;
}

/**
 * Drone work delivered on a job site, shown the way DroneDeploy shows it: the
 * map, a 3D view of the model or point cloud, and every exported layer to
 * download — so the platform team can judge it before approving.
 */
export function DeliveredDroneWork({
  captures,
  mapLayers = [],
  token = null,
  canPrepareDeepZoom = false,
}: {
  captures: DeliveredDroneCapture[];
  /** The delivered maps placed on the satellite map, when their files carry a location. */
  mapLayers?: DroneMapLayer[];
  token?: string | null;
  canPrepareDeepZoom?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ images: DeliveredDroneCapture["images"]; index: number } | null>(null);
  if (captures.length === 0) return null;
  const current = viewing ? viewing.images[viewing.index] : null;

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Drone work delivered</p>
      {mapLayers.length > 0 ? <DroneMapViewer token={token} layers={mapLayers} canPrepareDeepZoom={canPrepareDeepZoom} /> : null}
      {captures.map((capture) => {
        const map = capture.outputs.find((o) => o.outputType === "ORTHOMOSAIC" && isBrowserImage(o.storageKey));
        const files = capture.outputs.filter((o) => !o.preview);
        return (
          <div key={capture.id} className="space-y-2">
            <p className="text-xs text-muted">
              {capture.notes ?? "Uploaded by the vendor"} · {capture.status.toLowerCase()}
            </p>
            {capture.status === "PROCESSING" && capture.outputs.length === 0 ? (
              <p className="text-sm text-muted">DroneDeploy is still preparing this map; it appears here when copied in.</p>
            ) : null}
            {map ? (
              <a href={map.downloadUrl} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={map.downloadUrl} alt="Drone map" className="max-h-[420px] rounded-lg border border-border" />
              </a>
            ) : null}
            {files.length > 0 ? (
              <ul className="space-y-1.5">
                {files.map((o) => {
                  const viewable = (o.outputType === "POINT_CLOUD" || o.outputType === "MESH_3D") && isViewableIn3D(o.storageKey);
                  return (
                    <li key={o.id}>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-foreground">{OUTPUT_LABELS[o.outputType] ?? o.outputType}</span>
                        <a href={o.downloadUrl} className="text-brand hover:underline">
                          {displayFilename(o.storageKey)} ↓
                        </a>
                        {viewable ? (
                          <Button type="button" variant="ghost" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                            {expanded === o.id ? "Hide 3D" : "View in 3D"}
                          </Button>
                        ) : null}
                      </div>
                      {expanded === o.id ? <Object3DViewer downloadUrl={o.downloadUrl} storageKey={o.storageKey} /> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {capture.imageCount > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted">
                  HD images ({capture.imageCount})
                  {capture.imageCount > capture.images.length ? ` · first ${capture.images.length} shown` : ""}
                </p>
                <ul className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {capture.images.map((img, index) => (
                    <li key={img.id}>
                      <button
                        type="button"
                        onClick={() => setViewing({ images: capture.images, index })}
                        className="block w-full overflow-hidden rounded-lg border border-border hover:border-brand"
                        aria-label={`Open HD image ${index + 1}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated API route */}
                        <img src={img.thumbnailUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        );
      })}
      {viewing && current ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="HD image"
          className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") setViewing(null);
            if (e.key === "ArrowRight") setViewing((v) => v && { ...v, index: Math.min(v.images.length - 1, v.index + 1) });
            if (e.key === "ArrowLeft") setViewing((v) => v && { ...v, index: Math.max(0, v.index - 1) });
          }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div className="flex items-center justify-between text-sm text-white">
            <span>
              HD image {viewing.index + 1} of {viewing.images.length}
            </span>
            <div className="flex items-center gap-3">
              <a href={current.originalUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                Full resolution ↗
              </a>
              <button type="button" onClick={() => setViewing(null)} className="rounded-full bg-white/15 px-3 py-1 hover:bg-white/25">
                Close
              </button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            {viewing.index > 0 ? (
              <button
                type="button"
                onClick={() => setViewing({ ...viewing, index: viewing.index - 1 })}
                className="absolute left-2 rounded-full bg-white/80 px-3 py-2 text-lg"
                aria-label="Previous HD image"
              >
                ‹
              </button>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated API route */}
            <img key={current.id} src={current.previewUrl} alt="" className="max-h-full max-w-full object-contain" />
            {viewing.index < viewing.images.length - 1 ? (
              <button
                type="button"
                onClick={() => setViewing({ ...viewing, index: viewing.index + 1 })}
                className="absolute right-2 rounded-full bg-white/80 px-3 py-2 text-lg"
                aria-label="Next HD image"
              >
                ›
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
