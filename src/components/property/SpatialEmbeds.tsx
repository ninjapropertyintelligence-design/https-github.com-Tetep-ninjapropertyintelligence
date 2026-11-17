"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";
import { EMBED_KIND_LABELS, embedFrameSrc, embedUrlProblem, opensInNewTab } from "@/lib/embed-url";

type Kind = keyof typeof EMBED_KIND_LABELS;

export interface EmbedRow {
  id: string;
  kind: Kind;
  name: string;
  url: string;
  floorId: string | null;
  floorName: string | null;
  capturedAt: string | null;
}

/** A Matterport space linked on the Interior tab, shown here so every 3D view of the site is in one list. */
export interface ConnectedTourRow {
  id: string;
  name: string;
  url: string;
  capturedAt: string | null;
}

/** One entry in the list, whichever way it got there. */
interface Viewable {
  key: string;
  name: string;
  url: string;
  kind: Kind;
}

const INPUT = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand";

const dateInputValue = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function SpatialEmbeds({
  propertyId,
  embeds,
  connectedTours = [],
  canManage,
  floors,
}: {
  propertyId: string;
  embeds: EmbedRow[];
  connectedTours?: ConnectedTourRow[];
  canManage: boolean;
  floors: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [viewing, setViewing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewables: Viewable[] = [
    ...connectedTours.map((t) => ({ key: `tour:${t.id}`, name: t.name, url: t.url, kind: "MATTERPORT" as const })),
    ...embeds.map((e) => ({ key: `embed:${e.id}`, name: e.name, url: e.url, kind: e.kind })),
  ];
  const open = viewables.find((v) => v.key === viewing) ?? null;

  async function save(url: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await apiRequest(url, { method, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  async function remove(embed: EmbedRow) {
    if (!window.confirm(`Remove "${embed.name}"? The tour or model itself is not touched.`)) return;
    setBusy(true);
    const res = await apiRequest(`/api/v1/embeds/${embed.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      if (viewing === `embed:${embed.id}`) setViewing(null);
      router.refresh();
    }
  }

  function viewButton(v: Viewable) {
    return opensInNewTab(v.kind) ? (
      <a href={v.url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-zinc-50">
        Open ↗
      </a>
    ) : (
      <Button variant="secondary" onClick={() => setViewing(viewing === v.key ? null : v.key)}>
        {viewing === v.key ? "Close" : "View"}
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Embeds</h3>
          <p className="text-xs text-muted">Hosted tours, point clouds, models, videos and other viewers for this site.</p>
        </div>
        {canManage && !adding ? (
          <Button
            variant="secondary"
            onClick={() => {
              setAdding(true);
              setEditing(null);
            }}
          >
            Add 3D embed
          </Button>
        ) : null}
      </div>

      {adding ? (
        <EmbedForm
          floors={floors}
          submitLabel="Add"
          busy={busy}
          onCancel={() => setAdding(false)}
          onError={setError}
          onSubmit={async (body) => {
            if (await save(`/api/v1/properties/${propertyId}/embeds`, "POST", body)) setAdding(false);
          }}
        />
      ) : null}
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}

      {viewables.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-6 text-center text-sm text-muted">No 3D embeds yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {connectedTours.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-foreground">
                  {t.name}
                  <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">Connected</span>
                </p>
                <p className="text-xs text-muted">
                  Matterport tour · linked on the Interior tab
                  {t.capturedAt ? ` · ${new Date(t.capturedAt).toLocaleDateString()}` : ""}
                </p>
              </div>
              {viewButton({ key: `tour:${t.id}`, name: t.name, url: t.url, kind: "MATTERPORT" })}
            </li>
          ))}
          {embeds.map((e) =>
            editing === e.id ? (
              <li key={e.id} className="p-3">
                <EmbedForm
                  floors={floors}
                  initial={e}
                  submitLabel="Save"
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onError={setError}
                  onSubmit={async (body) => {
                    if (await save(`/api/v1/embeds/${e.id}`, "PATCH", body)) setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-foreground">{e.name}</p>
                  <p className="text-xs text-muted">
                    {EMBED_KIND_LABELS[e.kind]} · {e.floorName ?? "Whole site"}
                    {e.capturedAt ? ` · ${new Date(e.capturedAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  {viewButton({ key: `embed:${e.id}`, name: e.name, url: e.url, kind: e.kind })}
                  {canManage ? (
                    <>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setEditing(e.id);
                          setAdding(false);
                          setError(null);
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" disabled={busy} onClick={() => remove(e)}>
                        Remove
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ),
          )}
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
            key={open.key}
            src={embedFrameSrc(open.kind, open.url)}
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

function EmbedForm({
  floors,
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  onError,
}: {
  floors: Array<{ id: string; name: string }>;
  initial?: EmbedRow;
  submitLabel: string;
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  onError: (message: string | null) => void;
}) {
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "MATTERPORT");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const url = String(form.get("url") ?? "").trim();
    // Checked here as well as on the server, so a wrong link is explained
    // before anything is sent.
    const problem = embedUrlProblem(kind, url);
    if (problem) {
      onError(problem);
      return;
    }
    onError(null);
    await onSubmit({
      kind,
      name: form.get("name"),
      url,
      floorId: form.get("floorId") || null,
      capturedAt: form.get("capturedAt") || null,
    });
  }

  return (
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
        <input name="name" required maxLength={200} defaultValue={initial?.name ?? ""} className={INPUT} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted">Link</span>
        <input
          name="url"
          required
          type="url"
          defaultValue={initial?.url ?? ""}
          placeholder={
            kind === "MATTERPORT"
              ? "https://my.matterport.com/show/?m=…"
              : kind === "VIDEO"
                ? "https://www.youtube.com/watch?v=… or https://vimeo.com/…"
                : "https://…"
          }
          className={INPUT}
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted">Level (optional)</span>
        <select name="floorId" defaultValue={initial?.floorId ?? ""} className={INPUT}>
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
        <input type="date" name="capturedAt" defaultValue={dateInputValue(initial?.capturedAt ?? null)} className={INPUT} />
      </label>
      <div className="flex items-end gap-2">
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
