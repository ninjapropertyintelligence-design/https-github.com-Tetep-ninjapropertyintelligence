"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * The subcontractor's upload surface, on the job itself.
 *
 * Before this, a vendor had to leave the job, find the property page, and
 * upload one file at a time through a tab built for staff — and 360
 * panoramas had no control at all. A flight of 400 images was 400 clicks.
 *
 * Files go straight from the browser to object storage through signed URLs;
 * the bytes never pass through the app server. Registration then happens in
 * one batched call rather than one per file.
 */

/** What the vendor is handing over. The wording is theirs, not the schema's. */
const KINDS = [
  { key: "IMAGE_360", label: "360° panoramas", hint: "Equirectangular JPEGs from a 360 camera" },
  { key: "PHOTOS", label: "Photos", hint: "Ordinary site photos and defect evidence" },
  { key: "DRONE_IMAGERY", label: "Drone imagery", hint: "Raw flight images, straight off the card" },
] as const;

type Kind = (typeof KINDS)[number]["key"];

/** Registration batch size. The server caps evidence at 500 and drone images
 *  at 250; staying under both keeps one code path for every kind. */
const REGISTER_CHUNK = 200;

interface FileState {
  name: string;
  status: "pending" | "uploading" | "uploaded" | "failed";
  error?: string;
}

export interface ShotOption {
  id: string;
  label: string;
  kind: "PHOTO" | "IMAGE_360";
  captured: boolean;
}

export function CaptureUploadPanel({
  jobId,
  siteId,
  propertyId,
  shots,
  disabled,
}: {
  jobId: string;
  siteId: string;
  propertyId: string;
  /** The route for this site, in walking order. Empty when the job has none. */
  shots: ShotOption[];
  /** True once the site is accepted or the job is closed. */
  disabled: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>(shots.length > 0 ? "IMAGE_360" : "PHOTOS");
  // Defaults to the first position still outstanding, so a technician walking
  // the route does not have to re-pick it at every stop.
  const [shotId, setShotId] = useState<string>(() => shots.find((s) => !s.captured)?.id ?? "");
  const [files, setFiles] = useState<FileState[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /** Unwraps this API's envelope, whose `error` is a string, not an object. */
  async function call<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => null)) as { data?: T; error?: unknown } | null;
    if (!res.ok) {
      throw new Error(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`);
    }
    return payload?.data as T;
  }

  async function upload(selected: File[]) {
    setBusy(true);
    setError(null);
    setDone(null);
    setFiles(selected.map((f) => ({ name: f.name, status: "pending" as const })));

    const mark = (index: number, patch: Partial<FileState>) =>
      setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));

    try {
      // Drone imagery hangs off a capture and a dataset. The vendor picked
      // "drone imagery" and dropped files; the server resolves the rest, and
      // reuses an in-flight capture so uploading in three sittings does not
      // produce three captures of the same flight.
      let datasetId: string | null = null;
      if (kind === "DRONE_IMAGERY") {
        const target = await call<{ datasetId: string }>(
          `/api/v1/capture-jobs/${jobId}/sites/${siteId}`,
          { action: "drone-target" },
        );
        datasetId = target.datasetId;
      }

      const uploaded: Array<{ index: number; key: string; file: File }> = [];

      for (let start = 0; start < selected.length; start += REGISTER_CHUNK) {
        const chunk = selected.slice(start, start + REGISTER_CHUNK);

        const urlEndpoint =
          kind === "DRONE_IMAGERY" ? "/api/v1/drone/upload-url" : "/api/v1/evidence/upload-urls";

        // One round trip for the whole chunk's signed URLs. The drone
        // endpoint still mints one at a time, so it is called per file there.
        let signed: Array<{ url: string; key: string }>;
        if (kind === "DRONE_IMAGERY") {
          signed = [];
          for (const file of chunk) {
            signed.push(
              await call<{ url: string; key: string }>(urlEndpoint, {
                filename: file.name,
                contentType: file.type || "application/octet-stream",
              }),
            );
          }
        } else {
          const res = await call<{ urls: Array<{ url: string; key: string }> }>(urlEndpoint, {
            files: chunk.map((f) => ({
              filename: f.name,
              contentType: f.type || "application/octet-stream",
            })),
          });
          signed = res.urls;
        }

        // Uploaded a few at a time. One at a time wastes the link; all at
        // once opens hundreds of sockets and the browser starts queueing
        // them anyway, with no progress to show for it.
        const CONCURRENCY = 4;
        for (let i = 0; i < chunk.length; i += CONCURRENCY) {
          await Promise.all(
            chunk.slice(i, i + CONCURRENCY).map(async (file, offset) => {
              const index = start + i + offset;
              mark(index, { status: "uploading" });
              try {
                const put = await fetch(signed[i + offset].url, {
                  method: "PUT",
                  body: file,
                  headers: { "Content-Type": file.type || "application/octet-stream" },
                });
                if (!put.ok) throw new Error(`storage refused the file (HTTP ${put.status})`);
                mark(index, { status: "uploaded" });
                uploaded.push({ index, key: signed[i + offset].key, file });
              } catch (err) {
                // Recorded per file and not thrown: one bad file should not
                // discard an otherwise good flight.
                mark(index, { status: "failed", error: err instanceof Error ? err.message : "upload failed" });
              }
            }),
          );
        }
      }

      if (uploaded.length === 0) throw new Error("Nothing uploaded — every file failed.");

      // Register only what actually landed.
      for (let start = 0; start < uploaded.length; start += REGISTER_CHUNK) {
        const chunk = uploaded.slice(start, start + REGISTER_CHUNK);
        if (kind === "DRONE_IMAGERY") {
          await call(`/api/v1/drone/datasets/${datasetId}/images/batch`, {
            images: chunk.map((u) => ({
              storageKey: u.key,
              mimeType: u.file.type || undefined,
              sizeBytes: u.file.size,
            })),
          });
        } else {
          await call("/api/v1/evidence/batch", {
            items: chunk.map((u) => ({
              type: kind === "IMAGE_360" ? "IMAGE_360" : "PHOTO",
              storageKey: u.key,
              propertyId,
              // Drone imagery is a flight, not a position, so it never
              // carries a shot.
              captureShotId: shotId || undefined,
              mimeType: u.file.type || undefined,
              sizeBytes: u.file.size,
            })),
          });
        }
      }

      const failed = selected.length - uploaded.length;
      setDone(
        failed === 0
          ? `${uploaded.length} ${uploaded.length === 1 ? "file" : "files"} uploaded.`
          : `${uploaded.length} uploaded, ${failed} failed — retry the failed files.`,
      );
      if (inputRef.current) inputRef.current.value = "";
      // Refreshes the deliverable chips, which are computed from the data.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  if (disabled) return null;

  const uploadedCount = files.filter((f) => f.status === "uploaded").length;
  const failedFiles = files.filter((f) => f.status === "failed");

  return (
    <div className="mt-3 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`kind-${siteId}`}>
          What are you uploading?
        </label>
        <select
          id={`kind-${siteId}`}
          value={kind}
          disabled={busy}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-brand"
        >
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>

        <input
          ref={inputRef}
          type="file"
          multiple
          disabled={busy}
          accept={kind === "DRONE_IMAGERY" ? ".jpg,.jpeg,.png,.tif,.tiff" : "image/*"}
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            if (chosen.length > 0) upload(chosen);
          }}
          className="max-w-full text-sm text-foreground file:mr-2 file:rounded-lg file:border file:border-border file:bg-surface file:px-2.5 file:py-1.5 file:text-sm file:text-foreground"
        />
      </div>

      {shots.length > 0 && kind !== "DRONE_IMAGERY" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted" htmlFor={`shot-${siteId}`}>
            Position
          </label>
          <select
            id={`shot-${siteId}`}
            value={shotId}
            disabled={busy}
            onChange={(e) => setShotId(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-brand"
          >
            {/* Kept as an option rather than forced: a technician who finds a
                defect between positions still needs somewhere to put the
                photo, and refusing it would push them to mislabel it. */}
            <option value="">Not a listed position</option>
            {shots.map((shot) => (
              <option key={shot.id} value={shot.id}>
                {shot.captured ? "\u2713 " : ""}
                {shot.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <p className="mt-1.5 text-xs text-muted">{KINDS.find((k) => k.key === kind)!.hint}</p>

      {busy ? (
        <p className="mt-2 text-sm text-foreground">
          Uploading {uploadedCount} of {files.length}…
        </p>
      ) : null}

      {failedFiles.length > 0 && !busy ? (
        <ul className="mt-2 space-y-0.5 text-xs text-red-700">
          {failedFiles.slice(0, 5).map((f) => (
            <li key={f.name}>
              {f.name} — {f.error}
            </li>
          ))}
          {failedFiles.length > 5 ? <li>…and {failedFiles.length - 5} more</li> : null}
        </ul>
      ) : null}

      {done ? <p className="mt-2 text-sm text-foreground">{done}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
