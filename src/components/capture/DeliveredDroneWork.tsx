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
  images: Array<{ id: string; downloadUrl: string }>;
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
  if (captures.length === 0) return null;

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
                <p className="text-xs text-muted">{capture.imageCount} raw drone photos</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {capture.images.map((img) => (
                    <a key={img.id} href={img.downloadUrl} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.downloadUrl} alt="Drone photo" className="h-16 w-16 rounded object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
