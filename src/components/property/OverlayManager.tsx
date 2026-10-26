"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";
import { OVERLAY_CATEGORY_LABELS } from "@/lib/overlay-validation";

export interface OverlayRow {
  id: string;
  kind: "RASTER" | "VECTOR";
  category: string;
  name: string;
  floorName: string | null;
  capturedAt: string | null;
  isDefault: boolean;
  sizeBytes: number | null;
}

const INPUT = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand";

/** About 110 m either way: a starting box around the site to adjust, not a guess passed off as a survey. */
const DEFAULT_HALF_SPAN = 0.001;

export function OverlayManager({
  propertyId,
  overlays,
  canManage,
  center,
  floors,
}: {
  propertyId: string;
  overlays: OverlayRow[];
  canManage: boolean;
  center: { latitude: number; longitude: number } | null;
  floors: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"RASTER" | "VECTOR">("RASTER");

  async function act(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    const res = await apiRequest(url, init);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else router.refresh();
    return res;
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file to upload");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const contentType = kind === "VECTOR" ? "application/geo+json" : file.type || "application/octet-stream";
      const signed = await apiRequest("/api/v1/overlays/upload-url", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, contentType }),
      });
      if (!signed.ok) throw new Error(signed.error);
      const { url, key } = signed.data as { url: string; key: string };
      const put = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
      if (!put.ok) throw new Error(`Storage refused ${file.name} (HTTP ${put.status})`);
      const num = (name: string) => (form.get(name) === "" || form.get(name) === null ? null : Number(form.get(name)));
      const created = await apiRequest(`/api/v1/properties/${propertyId}/overlays`, {
        method: "POST",
        body: JSON.stringify({
          kind,
          category: form.get("category"),
          name: form.get("name"),
          storageKey: key,
          mimeType: contentType,
          floorId: form.get("floorId") || null,
          capturedAt: form.get("capturedAt") || null,
          isDefault: form.get("isDefault") === "on",
          ...(kind === "RASTER" ? { north: num("north"), south: num("south"), east: num("east"), west: num("west") } : {}),
        }),
      });
      if (!created.ok) throw new Error(created.error);
      setAdding(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Overlays</h2>
          <p className="text-sm text-muted">Plan sheets, aerials and GeoJSON layers laid over this site&apos;s map.</p>
        </div>
        {canManage && !adding ? <Button onClick={() => setAdding(true)}>Add overlay</Button> : null}
      </div>

      {adding ? (
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <div className="flex gap-2">
            {(["RASTER", "VECTOR"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${kind === k ? "border-brand bg-brand/10 text-brand" : "border-border text-muted"}`}
              >
                {k === "RASTER" ? "Image (PNG/JPEG/WebP)" : "GeoJSON"}
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted">File</span>
              <input type="file" name="file" required accept={kind === "RASTER" ? "image/png,image/jpeg,image/webp" : ".geojson,.json,application/geo+json,application/json"} className="block w-full text-sm" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted">Name</span>
              <input name="name" required maxLength={200} className={INPUT} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted">Category</span>
              <select name="category" defaultValue={kind === "RASTER" ? "AERIAL" : "OTHER"} key={kind} className={INPUT}>
                {Object.entries(OVERLAY_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted">Floor (optional)</span>
              <select name="floorId" defaultValue="" className={INPUT}>
                <option value="">Whole site</option>
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted">Captured / issued</span>
              <input type="date" name="capturedAt" className={INPUT} />
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
              <input type="checkbox" name="isDefault" /> Show when the map opens
            </label>
          </div>
          {kind === "RASTER" ? (
            <div>
              <p className="mb-1 text-xs text-muted">
                Edges of the image in decimal degrees. Pre-filled with a box around the site — move them to where the sheet&apos;s corners actually fall.
              </p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {(
                  [
                    ["north", center ? center.latitude + DEFAULT_HALF_SPAN : ""],
                    ["south", center ? center.latitude - DEFAULT_HALF_SPAN : ""],
                    ["east", center ? center.longitude + DEFAULT_HALF_SPAN : ""],
                    ["west", center ? center.longitude - DEFAULT_HALF_SPAN : ""],
                  ] as const
                ).map(([edge, value]) => (
                  <label key={edge} className="space-y-1 text-sm">
                    <span className="capitalize text-muted">{edge}</span>
                    <input type="number" step="any" name={edge} required defaultValue={value === "" ? "" : value.toFixed(6)} className={INPUT} />
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Uploading..." : "Add overlay"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {!adding && error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}

      {overlays.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-6 text-center text-sm text-muted">No overlays yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Name</th>
                <th className="px-5 py-2.5 font-medium">Type</th>
                <th className="px-5 py-2.5 font-medium">Category</th>
                <th className="px-5 py-2.5 font-medium">Floor</th>
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {overlays.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-medium text-foreground">
                    <a href={`/api/v1/overlays/${o.id}/content`} className="hover:text-brand">
                      {o.name}
                    </a>
                    {o.isDefault ? <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">Default</span> : null}
                  </td>
                  <td className="px-5 py-3 text-muted">{o.kind === "RASTER" ? "Raster" : "Vector"}</td>
                  <td className="px-5 py-3 text-muted">{OVERLAY_CATEGORY_LABELS[o.category] ?? o.category}</td>
                  <td className="px-5 py-3 text-muted">{o.floorName ?? "Whole site"}</td>
                  <td className="px-5 py-3 text-muted">{o.capturedAt ? new Date(o.capturedAt).toLocaleDateString() : "—"}</td>
                  <td className="px-5 py-3 text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => act(`/api/v1/overlays/${o.id}`, { method: "PATCH", body: JSON.stringify({ isDefault: !o.isDefault }) })}
                        >
                          {o.isDefault ? "Unset default" : "Make default"}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Delete the overlay "${o.name}" and its file?`)) {
                              void act(`/api/v1/overlays/${o.id}`, { method: "DELETE" });
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
