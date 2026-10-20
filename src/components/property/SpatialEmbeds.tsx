"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";
import { EMBED_KIND_LABELS, embedUrlProblem, opensInNewTab } from "@/lib/embed-url";

type Kind = keyof typeof EMBED_KIND_LABELS;

export interface EmbedRow {
  id: string;
  kind: Kind;
  name: string;
  url: string;
  floorName: string | null;
  capturedAt: string | null;
}

const INPUT = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand";

export function SpatialEmbeds({
  propertyId,
  embeds,
  canManage,
  floors,
}: {
  propertyId: string;
  embeds: EmbedRow[];
  canManage: boolean;
  floors: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [viewing, setViewing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>("MATTERPORT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = embeds.find((e) => e.id === viewing) ?? null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const url = String(form.get("url") ?? "").trim();
    const problem = embedUrlProblem(kind, url);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await apiRequest(`/api/v1/properties/${propertyId}/embeds`, {
      method: "POST",
      body: JSON.stringify({
        kind,
        name: form.get("name"),
        url,
        floorId: form.get("floorId") || null,
        capturedAt: form.get("capturedAt") || null,
      }),
    });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setAdding(false);
      router.refresh();
    }
  }

  async function remove(embed: EmbedRow) {
    if (!window.confirm(`Remove "${embed.name}"? The tour or model itself is not touched.`)) return;
    setBusy(true);
    const res = await apiRequest(`/api/v1/embeds/${embed.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      if (viewing === embed.id) setViewing(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">3D embeds</h3>
          <p className="text-xs text-muted">Hosted tours, point clouds and models for this site.</p>
        </div>
        {canManage && !adding ? (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add 3D embed
          </Button>
        ) : null}
      </div>

      {adding ? (
        <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted">Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={INPUT}>
              {Object.entries(EMBED_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Name</span>
            <input name="name" required maxLength={200} className={INPUT} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Link</span>
            <input
              name="url"
              required
              type="url"
              placeholder={kind === "MATTERPORT" ? "https://my.matterport.com/show/?m=…" : "https://…"}
              className={INPUT}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Level (optional)</span>
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
            <span className="text-muted">Captured</span>
            <input type="date" name="capturedAt" className={INPUT} />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={busy}>
              Add
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}

      {embeds.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-6 text-center text-sm text-muted">No 3D embeds yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {embeds.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-foreground">{e.name}</p>
                <p className="text-xs text-muted">
                  {EMBED_KIND_LABELS[e.kind]} · {e.floorName ?? "Whole site"}
                  {e.capturedAt ? ` · ${new Date(e.capturedAt).toLocaleDateString()}` : ""}
                </p>
              </div>
              <div className="flex gap-1">
                {opensInNewTab(e.kind) ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-zinc-50">
                    Open ↗
                  </a>
                ) : (
                  <Button variant="secondary" onClick={() => setViewing(viewing === e.id ? null : e.id)}>
                    {viewing === e.id ? "Close" : "View"}
                  </Button>
                )}
                {canManage ? (
                  <Button variant="ghost" disabled={busy} onClick={() => remove(e)}>
                    Remove
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between bg-zinc-50 px-4 py-2 text-xs text-muted">
            <span>
              {open.name} — {new URL(open.url).hostname}
            </span>
            <a href={open.url} target="_blank" rel="noopener noreferrer" className="hover:text-brand">
              Open in new tab ↗
            </a>
          </div>
          {/* Sandboxed: the viewer runs its own scripts on its own origin, and may
              go fullscreen, but cannot navigate this app or open forms here. */}
          <iframe
            src={open.url}
            title={open.name}
            className="h-[560px] w-full bg-black"
            sandbox="allow-scripts allow-same-origin allow-popups allow-fullscreen"
            allow="fullscreen; xr-spatial-tracking"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
        </div>
      ) : null}
    </div>
  );
}
