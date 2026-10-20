"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

const INPUT = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand";

export function NewCollectionForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await apiRequest("/api/v1/collections", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        description: form.get("description") || null,
        visibility: form.get("shared") === "on" ? "ORGANIZATION" : "PRIVATE",
      }),
    });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else router.push(`/collections/${res.data?.id}`);
  }

  if (!open) return <Button onClick={() => setOpen(true)}>New collection</Button>;
  return (
    <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-xl border border-border bg-surface p-4">
      <input name="name" required maxLength={200} placeholder="Name" className={INPUT} />
      <textarea name="description" maxLength={2000} rows={2} placeholder="What it's for (optional)" className={INPUT} />
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" name="shared" /> Share with the organization
      </label>
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Create
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "Add to collection" for one or more files, from the caller's own collections. */
export function AddToCollection({
  evidenceIds,
  collections,
  compact = false,
}: {
  evidenceIds: string[];
  collections: Array<{ id: string; name: string }>;
  compact?: boolean;
}) {
  const [collectionId, setCollectionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function add(target: string) {
    setBusy(true);
    setMessage(null);
    let id = target;
    if (target === "__new") {
      const name = window.prompt("Name the new collection");
      if (!name) {
        setBusy(false);
        setCollectionId("");
        return;
      }
      const created = await apiRequest("/api/v1/collections", { method: "POST", body: JSON.stringify({ name }) });
      if (!created.ok) {
        setBusy(false);
        setMessage(created.error);
        return;
      }
      id = String(created.data?.id);
    }
    const res = await apiRequest(`/api/v1/collections/${id}/items`, { method: "POST", body: JSON.stringify({ evidenceIds }) });
    setBusy(false);
    setCollectionId("");
    setMessage(res.ok ? "Added" : res.error);
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        aria-label="Add to collection"
        value={collectionId}
        disabled={busy}
        onChange={(e) => {
          setCollectionId(e.target.value);
          if (e.target.value) void add(e.target.value);
        }}
        className={`rounded-lg border border-border bg-surface text-foreground ${compact ? "max-w-full px-1 py-0.5 text-xs" : "px-3 py-1.5 text-sm"}`}
      >
        <option value="">{compact ? "+ Collect" : "Add to collection…"}</option>
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="__new">New collection…</option>
      </select>
      {message ? <span className="text-xs text-muted">{message}</span> : null}
    </span>
  );
}

export function RemoveFromCollection({ collectionId, evidenceId }: { collectionId: string; evidenceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await apiRequest(`/api/v1/collections/${collectionId}/items`, { method: "DELETE", body: JSON.stringify({ evidenceId }) });
        setBusy(false);
        if (res.ok) router.refresh();
      }}
      className="text-xs text-muted hover:text-[var(--band-critical)]"
    >
      Remove
    </button>
  );
}

export function CollectionSettings({
  collectionId,
  name,
  description,
  visibility,
}: {
  collectionId: string;
  name: string;
  description: string | null;
  visibility: "PRIVATE" | "ORGANIZATION";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await apiRequest(`/api/v1/collections/${collectionId}`, { method: "PATCH", body: JSON.stringify(patch) });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            const next = window.prompt("Rename collection", name);
            if (next && next !== name) void save({ name: next });
          }}
        >
          Rename
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            const next = window.prompt("Description", description ?? "");
            if (next !== null) void save({ description: next || null });
          }}
        >
          Edit description
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => save({ visibility: visibility === "PRIVATE" ? "ORGANIZATION" : "PRIVATE" })}>
          {visibility === "PRIVATE" ? "Share with organization" : "Make private"}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm(`Delete the collection "${name}"? The photos themselves are not deleted.`)) return;
            setBusy(true);
            const res = await apiRequest(`/api/v1/collections/${collectionId}`, { method: "DELETE" });
            setBusy(false);
            if (res.ok) router.push("/collections");
            else setError(res.error);
          }}
        >
          Delete collection
        </Button>
      </div>
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
    </div>
  );
}
