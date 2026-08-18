"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";

export interface DroneImageData {
  id: string;
  storageKey: string;
  downloadUrl: string;
  capturedAt: string | null;
}
export interface DroneOutputData {
  id: string;
  outputType: string;
  storageKey: string;
  downloadUrl: string;
}
export interface DroneDatasetData {
  id: string;
  images: DroneImageData[];
  outputs: DroneOutputData[];
}
export interface DroneCaptureData {
  id: string;
  status: string;
  capturedAt: string | null;
  droneModel: string | null;
  datasets: DroneDatasetData[];
}
export interface MarkerData {
  id: string;
  droneImageId: string | null;
  droneOutputId: string | null;
  xNormalized: number;
  yNormalized: number;
  label: string | null;
  asset: { id: string; name: string } | null;
  issue: { id: string; title: string; severity: string } | null;
}

const OUTPUT_TYPES = ["ORTHOMOSAIC", "POINT_CLOUD", "MESH_3D", "DSM", "DTM"] as const;

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function ExteriorManager({
  propertyId,
  captures,
  markers,
  canPerformCapture,
  canManageAssets,
  assets,
  issues,
}: {
  propertyId: string;
  captures: DroneCaptureData[];
  markers: MarkerData[];
  canPerformCapture: boolean;
  canManageAssets: boolean;
  assets: Array<{ id: string; name: string }>;
  issues: Array<{ id: string; title: string; severity: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureModel, setCaptureModel] = useState("");
  const [placingMarker, setPlacingMarker] = useState<{ imageId: string } | null>(null);
  const [pendingMarker, setPendingMarker] = useState<{ imageId: string; x: number; y: number } | null>(null);
  const [markerRef, setMarkerRef] = useState<{ kind: "asset" | "issue"; id: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeCapture = captures.find((c) => c.status !== "READY" && c.status !== "FAILED") ?? captures[0];
  const activeDataset = activeCapture?.datasets[0];
  const primaryImage = activeDataset?.images[0];
  const orthomosaic = activeDataset?.outputs.find((o) => o.outputType === "ORTHOMOSAIC");
  const displayImage = orthomosaic ?? primaryImage;

  async function startCapture() {
    setBusy(true);
    setError(null);
    try {
      const captureRes = await fetch(`/api/properties/${propertyId}/drone/captures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ droneModel: captureModel || undefined }),
      });
      if (!captureRes.ok) throw new Error((await captureRes.json().catch(() => ({}))).error ?? "Failed to create capture");
      const capture = await captureRes.json();
      const datasetRes = await fetch(`/api/drone/captures/${capture.id}/datasets`, { method: "POST" });
      if (!datasetRes.ok) throw new Error((await datasetRes.json().catch(() => ({}))).error ?? "Failed to create dataset");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File, kind: "PHOTO" | (typeof OUTPUT_TYPES)[number]) {
    if (!activeDataset) return;
    setBusy(true);
    setError(null);
    try {
      const uploadUrlRes = await fetch("/api/drone/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }),
      });
      if (!uploadUrlRes.ok) throw new Error("Failed to get upload URL");
      const { url, key } = await uploadUrlRes.json();

      const putRes = await fetch(url, { method: "PUT", body: file });
      if (!putRes.ok) throw new Error("Upload failed");

      const checksum = await sha256Hex(file);
      const registerPath =
        kind === "PHOTO" ? `/api/drone/datasets/${activeDataset.id}/images` : `/api/drone/datasets/${activeDataset.id}/outputs`;
      const registerBody =
        kind === "PHOTO"
          ? { storageKey: key, mimeType: file.type, sizeBytes: file.size, checksum }
          : { outputType: kind, storageKey: key, mimeType: file.type, sizeBytes: file.size, checksum };

      const registerRes = await fetch(registerPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registerBody),
      });
      if (!registerRes.ok) throw new Error((await registerRes.json().catch(() => ({}))).error ?? "Failed to register upload");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function markReady() {
    if (!activeCapture) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/drone/captures/${activeCapture.id}/ready`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to mark ready");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>, imageId: string) {
    if (!placingMarker) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPendingMarker({ imageId, x, y });
    setPlacingMarker(null);
  }

  async function saveMarker() {
    if (!pendingMarker || !markerRef) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/exterior/markers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          droneImageId: orthomosaic ? undefined : pendingMarker.imageId,
          droneOutputId: orthomosaic ? pendingMarker.imageId : undefined,
          xNormalized: pendingMarker.x,
          yNormalized: pendingMarker.y,
          [markerRef.kind === "asset" ? "assetId" : "issueId"]: markerRef.id,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save marker");
      setPendingMarker(null);
      setMarkerRef(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (captures.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          title="No exterior capture has been uploaded for this property."
          description="Once a drone capture is uploaded, aerial photos, orthomosaic, and exterior asset markers appear here."
          action={
            canPerformCapture ? (
              <div className="flex items-center gap-2">
                <input
                  value={captureModel}
                  onChange={(e) => setCaptureModel(e.target.value)}
                  placeholder="Drone model (optional)"
                  className="rounded-lg border border-border px-3 py-1.5 text-sm"
                />
                <Button onClick={startCapture} disabled={busy}>
                  {busy ? "Creating..." : "Start New Capture"}
                </Button>
              </div>
            ) : undefined
          }
        />
        {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
      </div>
    );
  }

  const relevantMarkers = markers.filter((m) => m.droneImageId === displayImage?.id || m.droneOutputId === displayImage?.id);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Capture Summary"
          subtitle={activeCapture ? `${activeCapture.droneModel ?? "Unknown drone"} — captured ${formatDate(activeCapture.capturedAt)}` : undefined}
          action={activeCapture ? <StatusBadge status={activeCapture.status} /> : undefined}
        />
        <CardBody className="space-y-3">
          {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}

          {displayImage ? (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayImage.downloadUrl}
                alt={orthomosaic ? "Orthomosaic" : "Drone photo"}
                onClick={(e) => handleImageClick(e, displayImage.id)}
                className={`max-h-[480px] rounded-lg border border-border ${placingMarker ? "cursor-crosshair" : ""}`}
              />
              {relevantMarkers.map((m) => (
                <Link
                  key={m.id}
                  href={m.asset ? `/assets/${m.asset.id}` : m.issue ? `/issues/${m.issue.id}` : "#"}
                  title={m.asset?.name ?? m.issue?.title ?? m.label ?? ""}
                  style={{ left: `${m.xNormalized * 100}%`, top: `${m.yNormalized * 100}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand text-[10px] font-bold text-white shadow"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full">{m.asset ? "A" : "I"}</span>
                </Link>
              ))}
              {pendingMarker && pendingMarker.imageId === displayImage.id ? (
                <span
                  style={{ left: `${pendingMarker.x * 100}%`, top: `${pendingMarker.y * 100}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 h-5 w-5 rounded-full border-2 border-white bg-amber-500 shadow"
                />
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">No photos or orthomosaic uploaded to this capture yet.</p>
          )}

          {canManageAssets && displayImage ? (
            <div className="flex flex-wrap items-center gap-2">
              {!placingMarker && !pendingMarker ? (
                <Button variant="secondary" onClick={() => setPlacingMarker({ imageId: displayImage.id })}>
                  + Add Marker
                </Button>
              ) : placingMarker ? (
                <span className="text-xs text-muted">Click on the image to place a marker...</span>
              ) : null}
              {pendingMarker ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                  <select
                    className="rounded border border-border px-2 py-1 text-xs"
                    onChange={(e) => {
                      const [kind, id] = e.target.value.split(":");
                      setMarkerRef(kind ? { kind: kind as "asset" | "issue", id } : null);
                    }}
                  >
                    <option value="">Reference...</option>
                    <optgroup label="Assets">
                      {assets.map((a) => (
                        <option key={a.id} value={`asset:${a.id}`}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Issues">
                      {issues.map((i) => (
                        <option key={i.id} value={`issue:${i.id}`}>
                          {i.title}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <Button onClick={saveMarker} disabled={!markerRef || busy}>
                    Save
                  </Button>
                  <Button variant="ghost" onClick={() => { setPendingMarker(null); setMarkerRef(null); }}>
                    Cancel
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {canPerformCapture ? (
        <Card>
          <CardHeader title="Upload to this Capture" subtitle="Direct signed upload — files never pass through the app server." />
          <CardBody className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileInputRef} type="file" className="text-sm" id="drone-file-input" />
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  const f = fileInputRef.current?.files?.[0];
                  if (f) uploadFile(f, "PHOTO");
                }}
              >
                Upload as Photo
              </Button>
              <select
                id="output-type-select"
                className="rounded-lg border border-border px-2 py-1.5 text-sm"
                defaultValue=""
                onChange={(e) => {
                  const f = fileInputRef.current?.files?.[0];
                  const type = e.target.value as (typeof OUTPUT_TYPES)[number];
                  if (f && type) uploadFile(f, type);
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  Upload as output type...
                </option>
                {OUTPUT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              {activeCapture && activeCapture.status !== "READY" ? (
                <Button onClick={markReady} disabled={busy}>
                  Mark Capture Ready
                </Button>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title={`Photos (${activeDataset?.images.length ?? 0})`} />
          <CardBody className="flex flex-wrap gap-2">
            {(activeDataset?.images ?? []).map((img) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={img.id} src={img.downloadUrl} alt="Drone photo" className="h-20 w-20 rounded object-cover" />
            ))}
            {(activeDataset?.images.length ?? 0) === 0 ? <p className="text-sm text-muted">No photos yet.</p> : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={`Other Outputs (${(activeDataset?.outputs.length ?? 0) - (orthomosaic ? 1 : 0)})`} />
          <CardBody className="space-y-1">
            {(activeDataset?.outputs ?? [])
              .filter((o) => o.outputType !== "ORTHOMOSAIC")
              .map((o) => (
                <a key={o.id} href={o.downloadUrl} className="block text-sm text-brand hover:underline">
                  {o.outputType.replace(/_/g, " ")} →
                </a>
              ))}
            {(activeDataset?.outputs.length ?? 0) - (orthomosaic ? 1 : 0) === 0 ? <p className="text-sm text-muted">No mesh/point-cloud/DSM/DTM outputs yet.</p> : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
