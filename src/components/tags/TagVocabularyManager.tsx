"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

interface ManagedType {
  id: string;
  name: string;
  allowMultiple: boolean;
  values: Array<{ id: string; name: string; propertyName: string | null }>;
}

const INPUT = "rounded-lg border border-border px-3 py-1.5 text-sm outline-none focus:border-brand";

export function TagVocabularyManager({ types, properties }: { types: ManagedType[]; properties: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    const res = await apiRequest(url, init);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else router.refresh();
    return res.ok;
  }

  /** Deleting strips the tag from every photo; say how many before doing it. */
  async function confirmDelete(kind: "type" | "value", id: string, name: string) {
    const usage = await apiRequest(`/api/v1/tags/usage?${kind === "type" ? "tagTypeId" : "tagValueId"}=${id}`, { method: "GET" });
    const counts = usage.ok ? (usage.data as { photos: number; responses: number }) : { photos: 0, responses: 0 };
    const where = counts.photos + counts.responses > 0 ? ` It is on ${counts.photos} photo(s) and ${counts.responses} task response(s), which will lose it.` : "";
    if (!window.confirm(`Delete ${kind === "type" ? "the tag type" : "the tag"} "${name}"?${where}`)) return;
    await act(`/api/v1/tags/${kind === "type" ? "types" : "values"}/${id}`, { method: "DELETE" });
  }

  async function addValue(e: FormEvent<HTMLFormElement>, tagTypeId: string) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const ok = await act("/api/v1/tags/values", {
      method: "POST",
      body: JSON.stringify({ tagTypeId, name: data.get("name"), propertyId: data.get("propertyId") || null }),
    });
    if (ok) form.reset();
  }

  async function addType(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const ok = await act("/api/v1/tags/types", {
      method: "POST",
      body: JSON.stringify({ name: data.get("name"), allowMultiple: data.get("allowMultiple") === "on" }),
    });
    if (ok) form.reset();
  }

  return (
    <div className="space-y-4">
      {types.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-foreground">No tags yet.</p>
          <p className="mt-1 text-sm text-muted">Start with Level, Area, Type, Category and free Tags, then rename or add to them.</p>
          <Button className="mt-3" disabled={busy} onClick={() => act("/api/v1/tags/standard", { method: "POST" })}>
            Add the standard tags
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}

      {types.map((type) => (
        <div key={type.id} className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{type.name}</h3>
              <p className="text-xs text-muted">{type.allowMultiple ? "A photo can have several" : "A photo has at most one"}</p>
            </div>
            <Button variant="ghost" disabled={busy} onClick={() => confirmDelete("type", type.id, type.name)}>
              Delete type
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {type.values.length === 0 ? <span className="text-xs text-muted">No values yet.</span> : null}
            {type.values.map((v) => (
              <span key={v.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-foreground">
                {v.name}
                {v.propertyName ? <span className="text-muted">· {v.propertyName} only</span> : null}
                <button type="button" disabled={busy} aria-label={`Delete ${v.name}`} onClick={() => confirmDelete("value", v.id, v.name)} className="text-muted hover:text-[var(--band-critical)]">
                  ×
                </button>
              </span>
            ))}
          </div>
          <form onSubmit={(e) => addValue(e, type.id)} className="flex flex-wrap gap-2">
            <input name="name" required maxLength={100} placeholder={`New ${type.name.toLowerCase()} value`} className={INPUT} />
            <select name="propertyId" defaultValue="" className={INPUT} aria-label="Where it is offered">
              <option value="">Every property</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  Only at {p.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" disabled={busy}>
              Add
            </Button>
          </form>
        </div>
      ))}

      {types.length > 0 ? (
        <form onSubmit={addType} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-4">
          <input name="name" required maxLength={100} placeholder="New tag type, e.g. Condition" className={INPUT} />
          <label className="flex items-center gap-1 text-sm text-foreground">
            <input type="checkbox" name="allowMultiple" /> Several per photo
          </label>
          <Button type="submit" variant="secondary" disabled={busy}>
            Add tag type
          </Button>
        </form>
      ) : null}
    </div>
  );
}
