"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import {
  METADATA_HEAD_BYTES,
  classifyPanorama,
  distanceMeters,
  readPanoramaMetadata,
  type PanoramaMetadata,
} from "@/lib/media/panorama-metadata";
import { matchPhotosToShots, type ShotMatch, type ShotTarget } from "@/lib/capture/shot-matching";

/**
 * Insta360 auto-import: point it at the camera's SD card (or any folder of
 * exports) and it works out what to upload on its own.
 *
 * Insta360 has no cloud API to pull from, so "auto" happens here, in the
 * browser, before anything is sent:
 *   - every file is read for its EXIF/XMP: when it was shot, where, and
 *     whether it is an equirectangular panorama at all;
 *   - camera originals (.insp/.insv) are named and skipped, with what to do;
 *   - panoramas shot far from this property are held back by default;
 *   - each file is hashed and checked against what the property already has,
 *     so re-importing a card that still holds last month's shoot uploads only
 *     what is new.
 * What is left is uploaded straight to storage and registered in one batch,
 * dated and geotagged from the camera rather than typed in by hand.
 *
 * When the site is on a capture route, each panorama is also given the shot
 * position it was taken at — by GPS against the route's pins, else by walking
 * order (see lib/capture/shot-matching.ts). The proposal is shown per file
 * and can be changed before anything uploads; the import then ticks off the
 * route the same way picking positions by hand would.
 */

/** Further than this from the property and a panorama is probably another site. */
const FAR_AWAY_METERS = 1000;
/** Signed URLs and registrations per round trip. */
const CHUNK = 100;
const UPLOAD_CONCURRENCY = 3;

type Verdict =
  | "ready"
  | "duplicate"
  | "far"
  | "needs-export"
  | "not-360"
  | "uploading"
  | "uploaded"
  | "failed";

interface Candidate {
  file: File;
  verdict: Verdict;
  reason?: string;
  meta?: PanoramaMetadata;
  sha256?: string;
  distance?: number;
  /** A position chosen by hand overrides the automatic match; "" means none. */
  manualShotId?: string;
}

/** The route this import can be matched against, when the site is on one. */
export interface ImportRoute {
  /** Shown above the list, e.g. the capture job's title. */
  label: string;
  shots: ShotTarget[];
}

const VERDICT_TEXT: Record<Verdict, string> = {
  ready: "Ready",
  duplicate: "Already imported",
  far: "Far from this property",
  "needs-export": "Needs export",
  "not-360": "Not a 360 photo",
  uploading: "Uploading…",
  uploaded: "Imported",
  failed: "Failed",
};

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function isHidden(file: File): boolean {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return path.split("/").some((part) => part.startsWith("."));
}

export function Insta360ImportPanel({
  propertyId,
  location,
  route,
  title = "Import from Insta360",
}: {
  propertyId: string;
  location: { latitude: number; longitude: number } | null;
  route?: ImportRoute | null;
  title?: string;
}) {
  const router = useRouter();
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [phase, setPhase] = useState<"idle" | "scanning" | "scanned" | "importing" | "done">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [includeFar, setIncludeFar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function scan(list: FileList | File[] | null) {
    const files = Array.from(list ?? []).filter((f) => !isHidden(f));
    if (files.length === 0) return;
    setError(null);
    setSummary(null);
    setPhase("scanning");
    setProgress({ done: 0, total: files.length });

    const scanned: Candidate[] = [];
    for (const [i, file] of files.entries()) {
      try {
        const lower = file.name.toLowerCase();
        const isJpeg = lower.endsWith(".jpg") || lower.endsWith(".jpeg");
        const meta = isJpeg
          ? readPanoramaMetadata(new Uint8Array(await file.slice(0, METADATA_HEAD_BYTES).arrayBuffer()))
          : null;
        const verdict = classifyPanorama(file.name, meta);
        if (verdict.kind === "NEEDS_EXPORT") {
          scanned.push({ file, verdict: "needs-export", reason: verdict.reason });
        } else if (verdict.kind === "NOT_PANORAMA") {
          scanned.push({ file, verdict: "not-360", reason: verdict.reason, meta: meta ?? undefined });
        } else {
          const distance =
            location && meta?.latitude != null && meta.longitude != null
              ? distanceMeters(location.latitude, location.longitude, meta.latitude, meta.longitude)
              : undefined;
          scanned.push({
            file,
            meta: meta ?? undefined,
            sha256: await sha256Hex(file),
            distance,
            verdict: distance !== undefined && distance > FAR_AWAY_METERS ? "far" : "ready",
          });
        }
      } catch {
        scanned.push({ file, verdict: "not-360", reason: "Could not read this file" });
      }
      setProgress({ done: i + 1, total: files.length });
    }

    // Duplicates last, in bulk, once every hash is known.
    try {
      const hashes = scanned.filter((c) => c.sha256).map((c) => c.sha256 as string);
      const existing = new Set<string>();
      for (let i = 0; i < hashes.length; i += 2000) {
        const res = await apiFetch<{ existing: string[] }>(`/api/v1/properties/${propertyId}/360/existing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checksums: hashes.slice(i, i + 2000) }),
        });
        res.existing.forEach((h) => existing.add(h));
      }
      // The same file twice on one card (copied into two folders) is also a duplicate.
      const seen = new Set<string>();
      for (const c of scanned) {
        if (!c.sha256) continue;
        if (existing.has(c.sha256) || seen.has(c.sha256)) c.verdict = "duplicate";
        seen.add(c.sha256);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not check for duplicates");
    }

    setCandidates(scanned);
    setPhase("scanned");
  }

  async function importAll() {
    const selected = candidates
      .map((c, index) => ({ c, index }))
      .filter(({ c }) => c.verdict === "ready" || (includeFar && c.verdict === "far"));
    if (selected.length === 0) return;
    setError(null);
    setPhase("importing");
    setProgress({ done: 0, total: selected.length });

    const mark = (index: number, verdict: Verdict, reason?: string) =>
      setCandidates((prev) => prev.map((c, i) => (i === index ? { ...c, verdict, reason } : c)));

    let imported = 0;
    let failed = 0;
    try {
      for (let start = 0; start < selected.length; start += CHUNK) {
        const chunk = selected.slice(start, start + CHUNK);
        const { urls } = await apiFetch<{ urls: Array<{ url: string; key: string }> }>("/api/v1/evidence/upload-urls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: chunk.map(({ c }) => ({ filename: c.file.name, contentType: c.file.type || "image/jpeg" })),
          }),
        });

        const landed: Array<{ c: Candidate; index: number; key: string }> = [];
        for (let i = 0; i < chunk.length; i += UPLOAD_CONCURRENCY) {
          await Promise.all(
            chunk.slice(i, i + UPLOAD_CONCURRENCY).map(async ({ c, index }, offset) => {
              const signed = urls[i + offset];
              mark(index, "uploading");
              try {
                const put = await fetch(signed.url, {
                  method: "PUT",
                  body: c.file,
                  headers: { "Content-Type": c.file.type || "image/jpeg" },
                });
                if (!put.ok) throw new Error(`storage refused the file (HTTP ${put.status})`);
                landed.push({ c, index, key: signed.key });
              } catch (err) {
                failed++;
                mark(index, "failed", err instanceof Error ? err.message : "upload failed");
              }
              setProgress((p) => ({ ...p, done: p.done + 1 }));
            }),
          );
        }
        if (landed.length === 0) continue;

        await apiFetch("/api/v1/evidence/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: landed.map(({ index, c, key }) => ({
              type: "IMAGE_360",
              storageKey: key,
              propertyId,
              captureShotId: route ? shotFor(index) : null,
              mimeType: c.file.type || "image/jpeg",
              sizeBytes: c.file.size,
              captureDate: c.meta?.capturedAt ? c.meta.capturedAt.toISOString() : null,
              latitude: c.meta?.latitude ?? null,
              longitude: c.meta?.longitude ?? null,
              metadata: {
                source: "insta360-import",
                sha256: c.sha256,
                originalFilename: c.file.name,
                cameraMake: c.meta?.make ?? null,
                cameraModel: c.meta?.model ?? null,
                width: c.meta?.width ?? null,
                height: c.meta?.height ?? null,
              },
            })),
          }),
        });
        for (const { index } of landed) mark(index, "uploaded");
        imported += landed.length;
      }
      setSummary(
        failed === 0
          ? `${imported} ${imported === 1 ? "panorama" : "panoramas"} imported.`
          : `${imported} imported, ${failed} failed — run the import again to retry them; finished ones are skipped.`,
      );
      setPhase("done");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Import failed");
      setPhase("scanned");
    }
  }

  const included = (c: Candidate) => c.verdict === "ready" || (includeFar && c.verdict === "far");

  // Recomputed from the candidates, so a toggle or a manual pick on one file
  // re-runs walking-order matching for the rest.
  const matches = useMemo(() => {
    if (!route || route.shots.length === 0) return new Map<number, ShotMatch>();
    const pending = candidates
      .map((c, index) => ({ c, index }))
      .filter(({ c }) => included(c) && c.manualShotId === undefined);
    // Positions picked by hand are taken; the automatic pass works around them.
    const takenByHand = new Set(candidates.filter((c) => included(c) && c.manualShotId).map((c) => c.manualShotId));
    const shots = route.shots.map((s) => (takenByHand.has(s.id) ? { ...s, captured: true } : s));
    const byKey = matchPhotosToShots(
      pending.map(({ c, index }) => ({
        key: String(index),
        filename: c.file.name,
        latitude: c.meta?.latitude ?? null,
        longitude: c.meta?.longitude ?? null,
        capturedAt: c.meta?.capturedAt ?? null,
      })),
      shots,
    );
    return new Map(pending.map(({ index }) => [index, byKey.get(String(index))!]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, includeFar, route]);

  function shotFor(index: number): string | null {
    const c = candidates[index];
    if (c.manualShotId !== undefined) return c.manualShotId || null;
    return matches.get(index)?.shotId ?? null;
  }

  function matchNote(index: number): string {
    const c = candidates[index];
    if (c.manualShotId !== undefined) return "chosen by hand";
    const m = matches.get(index);
    if (!m) return "";
    if (m.method === "GPS") return `matched by GPS, ${Math.round(m.distanceMeters)} m`;
    if (m.method === "ORDER") return "matched by walking order";
    return m.reason;
  }

  const count = (v: Verdict) => candidates.filter((c) => c.verdict === v).length;
  const toImport = count("ready") + (includeFar ? count("far") : 0);
  const busy = phase === "scanning" || phase === "importing";

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 max-w-xl text-xs text-muted">
            Choose the camera&apos;s SD card or a folder of exported 360 JPGs. Dates and locations come from the camera;
            photos already here are skipped.
            {route && route.shots.length > 0
              ? ` Each photo is matched to a position on the route for "${route.label}".`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => folderInput.current?.click()}>
            Choose folder
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => filesInput.current?.click()}>
            Choose files
          </Button>
        </div>
        <input
          ref={folderInput}
          type="file"
          multiple
          className="hidden"
          // Not in React's input typings, but supported by every current browser.
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            void scan(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={filesInput}
          type="file"
          multiple
          accept=".jpg,.jpeg,.insp,.insv"
          className="hidden"
          onChange={(e) => {
            void scan(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {busy ? (
        <p className="mt-3 text-sm text-muted">
          {phase === "scanning" ? "Reading" : "Uploading"} {progress.done} of {progress.total}…
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-[var(--band-critical)]">{error}</p> : null}
      {summary ? <p className="mt-3 text-sm text-[var(--band-good)]">{summary}</p> : null}

      {candidates.length > 0 && phase !== "scanning" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-foreground">
            <span className="font-medium">{count("ready")}</span> ready
            {count("duplicate") ? ` · ${count("duplicate")} already imported` : ""}
            {count("far") ? ` · ${count("far")} far from this property` : ""}
            {count("needs-export") ? ` · ${count("needs-export")} need export from the Insta360 app` : ""}
            {count("not-360") ? ` · ${count("not-360")} not 360 photos` : ""}
          </p>
          {route && route.shots.length > 0 && phase === "scanned" && toImport > 0 ? (
            <p className="text-xs text-muted">
              {(() => {
                const indexes = candidates.map((c, i) => (included(c) ? i : -1)).filter((i) => i >= 0);
                const placed = indexes.filter((i) => shotFor(i) !== null).length;
                return `${placed} of ${indexes.length} matched to a route position${
                  placed < indexes.length ? " — check the rest below, or leave them unlisted" : ""
                }.`;
              })()}
            </p>
          ) : null}
          {count("far") > 0 ? (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={includeFar} onChange={(e) => setIncludeFar(e.target.checked)} />
              Include the {count("far")} taken more than {FAR_AWAY_METERS / 1000} km from this property
            </label>
          ) : null}
          {phase === "scanned" ? (
            <Button disabled={toImport === 0} onClick={() => void importAll()}>
              Import {toImport} {toImport === 1 ? "panorama" : "panoramas"}
            </Button>
          ) : null}
          <ul className="max-h-64 overflow-y-auto rounded-lg border border-border text-xs">
            {candidates.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 last:border-0">
                <span className="min-w-0 truncate text-foreground">{c.file.name}</span>
                {route && route.shots.length > 0 && included(c) && phase === "scanned" ? (
                  <span className="flex items-center gap-2">
                    <select
                      aria-label={`Position for ${c.file.name}`}
                      value={shotFor(i) ?? ""}
                      onChange={(e) =>
                        setCandidates((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, manualShotId: e.target.value } : x)),
                        )
                      }
                      className="max-w-48 rounded border border-border bg-white px-1.5 py-0.5 text-xs"
                    >
                      <option value="">Not a listed position</option>
                      {route.shots.map((shot) => (
                        <option key={shot.id} value={shot.id}>
                          {shot.sequence}. {shot.label}
                          {shot.captured ? " ✓" : ""}
                        </option>
                      ))}
                    </select>
                    <span className="text-muted">{matchNote(i)}</span>
                  </span>
                ) : null}
                <span className="shrink-0 text-right text-muted">
                  {VERDICT_TEXT[c.verdict]}
                  {c.verdict === "far" && c.distance !== undefined ? ` (${(c.distance / 1000).toFixed(1)} km)` : ""}
                  {c.reason && c.verdict !== "ready" ? ` — ${c.reason}` : ""}
                  {c.verdict === "ready" && c.meta?.capturedAt ? ` · ${c.meta.capturedAt.toLocaleDateString()}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
