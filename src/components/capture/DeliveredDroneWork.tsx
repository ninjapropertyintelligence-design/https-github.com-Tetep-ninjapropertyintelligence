"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
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
            <FullResolutionImage key={current.id} previewUrl={current.previewUrl} originalUrl={current.originalUrl} />
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

/**
 * One HD image at its full resolution. The preview shows at once; the
 * original replaces it as soon as it has downloaded, so what is on screen
 * ends up being every pixel the drone captured. Clicking toggles between
 * fitting the screen and 100% (one image pixel per screen pixel), scrolled
 * to wherever was clicked.
 */
function FullResolutionImage({ previewUrl, originalUrl }: { previewUrl: string; originalUrl: string }) {
  const [src, setSrc] = useState(previewUrl);
  const [full, setFull] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setSrc(originalUrl);
      setFull(true);
    };
    img.src = originalUrl;
    return () => {
      img.onload = null;
    };
  }, [originalUrl]);

  function toggle(event: React.MouseEvent<HTMLImageElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - box.left) / box.width;
    const fy = (event.clientY - box.top) / box.height;
    const next = !actualSize;
    setActualSize(next);
    if (next) {
      // Once laid out at full size, scroll so the clicked spot is centred.
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollLeft = fx * el.scrollWidth - el.clientWidth / 2;
        el.scrollTop = fy * el.scrollHeight - el.clientHeight / 2;
      });
    }
  }

  return (
    <div ref={scrollRef} className={`h-full w-full ${actualSize ? "overflow-auto" : "flex items-center justify-center overflow-hidden"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated API route */}
      <img
        src={src}
        alt=""
        onClick={toggle}
        className={actualSize ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain"}
      />
      <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
        {full ? "Full resolution" : "Loading full resolution…"} · click to {actualSize ? "fit to screen" : "zoom to 100%"}
      </span>
    </div>
  );
}
