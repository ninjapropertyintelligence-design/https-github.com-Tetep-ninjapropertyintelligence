"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { guessOutputType, type FinishedOutputType as OutputType } from "@/lib/drone-display";
import { cornersFromBBox, isSupportedEpsg, type LngLat } from "@/lib/geo/georeference";

/**
 * Finished drone outputs a vendor exported from DroneDeploy (or any
 * photogrammetry tool) and uploads by hand — the route for vendors whose
 * DroneDeploy plan has no API access.
 *
 * Each file is filed as the kind of output it is, guessed from its name and
 * changeable before upload. A GeoTIFF map is what DroneDeploy exports by
 * default and no browser can display one, so a JPEG preview is made from it
 * here, in the vendor's browser, and uploaded beside it: the original stays
 * downloadable at full quality, the preview is what everyone sees.
 */


const TYPE_LABELS: Record<OutputType, string> = {
  ORTHOMOSAIC: "Map (orthomosaic)",
  DSM: "Elevation (DSM)",
  DTM: "Terrain (DTM)",
  POINT_CLOUD: "Point cloud",
  MESH_3D: "3D model",
};

const ACCEPT = ".tif,.tiff,.jpg,.jpeg,.png,.las,.laz,.xyz,.ply,.obj,.glb,.gltf,.fbx,.zip";

/** The longest side of the preview made from a GeoTIFF map. */
const PREVIEW_SIZE = 4096;
/** Above this a preview is not attempted: decoding would exhaust the browser. */
const MAX_PREVIEW_SOURCE_BYTES = 1024 * 1024 * 1024;

interface Pending {
  file: File;
  type: OutputType;
  status: "ready" | "uploading" | "done" | "failed";
  note?: string;
}

async function call<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = (await res.json().catch(() => null)) as { data?: T; error?: unknown } | null;
  if (!res.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`);
  return payload?.data as T;
}

async function putFile(file: Blob, filename: string, contentType: string): Promise<string> {
  const signed = await call<{ url: string; key: string }>("/api/v1/drone/upload-url", { filename, contentType });
  const put = await fetch(signed.url, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
  if (!put.ok) throw new Error(`storage refused the file (HTTP ${put.status})`);
  return signed.key;
}

/**
 * A JPEG preview of a GeoTIFF map, made from its smallest sufficient
 * overview, and where its corners are on Earth — read from the file's own
 * georeferencing, so the viewer can lay it on the satellite map in place.
 */
async function geotiffPreview(file: File): Promise<{ blob: Blob; corners: [LngLat, LngLat, LngLat, LngLat] | null; epsg: number | null }> {
  const { fromBlob } = await import("geotiff");
  const tiff = await fromBlob(file);
  const count = await tiff.getImageCount();
  const full = await tiff.getImage(0);
  let corners: [LngLat, LngLat, LngLat, LngLat] | null = null;
  let epsg: number | null = null;
  try {
    const keys = (full.getGeoKeys?.() ?? {}) as { ProjectedCSTypeGeoKey?: number; GeographicTypeGeoKey?: number };
    epsg = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey ?? null;
    const bbox = full.getBoundingBox() as [number, number, number, number];
    if (epsg && isSupportedEpsg(epsg)) corners = cornersFromBBox(bbox, epsg);
  } catch {
    // Not georeferenced: the map is still shown, just not placed.
  }
  // Overviews, when present, follow the full-resolution image. The smallest
  // one that is still at least preview-sized is far cheaper to decode.
  let image = full;
  for (let i = 1; i < count; i++) {
    const candidate = await tiff.getImage(i);
    if (Math.max(candidate.getWidth(), candidate.getHeight()) >= PREVIEW_SIZE) image = candidate;
  }
  const scale = Math.min(1, PREVIEW_SIZE / Math.max(image.getWidth(), image.getHeight()));
  const width = Math.max(1, Math.round(image.getWidth() * scale));
  const height = Math.max(1, Math.round(image.getHeight() * scale));
  const rgb = (await image.readRGB({ width, height, interleave: true, enableAlpha: true })) as unknown as ArrayLike<number> & {
    length: number;
  };
  const channels = rgb.length / (width * height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the preview");
  const pixels = context.createImageData(width, height);
  for (let p = 0, q = 0; p < width * height; p++, q += channels) {
    const alpha = channels === 4 ? rgb[q + 3] : 255;
    // No-data areas outside the flight become white rather than black.
    pixels.data[p * 4] = alpha === 0 ? 255 : rgb[q];
    pixels.data[p * 4 + 1] = alpha === 0 ? 255 : rgb[q + 1];
    pixels.data[p * 4 + 2] = alpha === 0 ? 255 : rgb[q + 2];
    pixels.data[p * 4 + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the preview"))), "image/jpeg", 0.85),
  );
  return { blob, corners, epsg };
}

export function DroneMapUploader({ jobId, siteId }: { jobId: string; siteId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const update = (index: number, patch: Partial<Pending>) =>
    setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  async function upload() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { datasetId } = await call<{ datasetId: string }>(`/api/v1/capture-jobs/${jobId}/sites/${siteId}`, {
        action: "drone-target",
      });
      let ok = 0;
      for (let i = 0; i < items.length; i++) {
        const { file, type, status } = items[i];
        if (status === "done") continue;
        update(i, { status: "uploading", note: undefined });
        try {
          const contentType = file.type || "application/octet-stream";
          const key = await putFile(file, file.name, contentType);
          const registered = await call<{ id: string }>(`/api/v1/drone/datasets/${datasetId}/outputs`, {
            outputType: type,
            storageKey: key,
            mimeType: contentType,
            sizeBytes: file.size,
            metadata: { originalFilename: file.name, source: "vendor-upload" },
          });

          let note: string | undefined;
          const isGeoTiff = /\.tiff?$/i.test(file.name);
          if (type === "ORTHOMOSAIC" && isGeoTiff) {
            if (file.size > MAX_PREVIEW_SOURCE_BYTES) {
              note = "uploaded; too large to preview here — also upload a JPG export of the map so it can be viewed";
            } else {
              try {
                const preview = await geotiffPreview(file);
                const previewName = `${file.name.replace(/\.tiff?$/i, "")}-preview.jpg`;
                const previewKey = await putFile(preview.blob, previewName, "image/jpeg");
                await call(`/api/v1/drone/datasets/${datasetId}/outputs`, {
                  outputType: "ORTHOMOSAIC",
                  storageKey: previewKey,
                  mimeType: "image/jpeg",
                  sizeBytes: preview.blob.size,
                  metadata: {
                    originalFilename: previewName,
                    previewOf: key,
                    previewOfOutputId: registered.id,
                    preview: true,
                    source: "vendor-upload",
                    corners: preview.corners,
                    epsg: preview.epsg,
                  },
                });
                note = preview.corners
                  ? "uploaded, with a viewable preview placed on the map"
                  : "uploaded, with a viewable preview (no location data in the file, so it is not placed on the map)";
              } catch {
                note = "uploaded; a preview could not be made from this file — also upload a JPG export so it can be viewed";
              }
            }
          }
          // Deep zoom: hand the full map to Mapbox to tile. Not waited on —
          // it runs on the server, and is simply skipped where not set up.
          if (type === "ORTHOMOSAIC" && isGeoTiff) {
            void fetch(`/api/v1/drone/outputs/${registered.id}/tiles`, { method: "POST" }).catch(() => {});
          }
          update(i, { status: "done", note });
          ok++;
        } catch (err) {
          update(i, { status: "failed", note: err instanceof Error ? err.message : "upload failed" });
        }
      }
      setDone(ok > 0 ? `${ok} ${ok === 1 ? "file" : "files"} uploaded.` : null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Export from DroneDeploy (Export → choose the layer) and upload the files here: the map, elevation, point cloud
        or 3D model. Each is shown on the site the same way as in DroneDeploy once approved.
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        disabled={busy}
        aria-label="Finished drone files"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          setItems(files.map((file) => ({ file, type: guessOutputType(file.name), status: "ready" as const })));
          setDone(null);
          setError(null);
        }}
        className="block text-sm"
      />
      {items.length > 0 ? (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={`${it.file.name}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 max-w-xs truncate text-foreground">{it.file.name}</span>
              <span className="text-xs text-muted">{(it.file.size / 1024 / 1024).toFixed(1)} MB</span>
              <select
                aria-label={`What ${it.file.name} is`}
                value={it.type}
                disabled={busy || it.status === "done"}
                onChange={(e) => update(i, { type: e.target.value as OutputType })}
                className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground"
              >
                {(Object.keys(TYPE_LABELS) as OutputType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <span
                className={`text-xs ${
                  it.status === "failed" ? "text-[var(--band-critical)]" : it.status === "done" ? "text-[var(--band-good)]" : "text-muted"
                }`}
              >
                {it.status === "uploading" ? "uploading…" : it.status === "done" ? "✓" : it.status === "failed" ? "failed" : ""}
                {it.note ? ` ${it.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {items.length > 0 ? (
        <Button type="button" disabled={busy || items.every((it) => it.status === "done")} onClick={upload}>
          {busy ? "Uploading…" : `Upload ${items.filter((it) => it.status !== "done").length} file(s)`}
        </Button>
      ) : null}
      {done ? <p className="text-sm text-[var(--band-good)]">{done}</p> : null}
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
    </div>
  );
}
