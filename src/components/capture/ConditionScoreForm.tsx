"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

/** Plain-language bands, so a vendor does not have to know what 64 means. */
const BANDS = [
  { score: 95, label: "Excellent — like new" },
  { score: 80, label: "Good — normal wear" },
  { score: 60, label: "Fair — needs attention soon" },
  { score: 40, label: "Poor — needs repair" },
  { score: 15, label: "Critical — failing or unsafe" },
];

/**
 * The vendor rating each asset at the site. This is the deliverable that
 * moves the property's health score; imagery alone does not.
 */
export function ConditionScoreForm({
  jobId,
  siteId,
  assets,
}: {
  jobId: string;
  siteId: string;
  assets: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    const entries = assets
      .filter((a) => scores[a.id] !== undefined && scores[a.id] !== "")
      .map((a) => ({ assetId: a.id, score: Number(scores[a.id]), reason: notes[a.id]?.trim() || null }));
    if (entries.length === 0) {
      setError("Rate at least one asset.");
      return;
    }
    if (entries.some((e) => !Number.isFinite(e.score) || e.score < 0 || e.score > 100)) {
      setError("Scores are from 0 (failed) to 100 (like new).");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/capture-jobs/${jobId}/sites/${siteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "conditions", scores: entries }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        setError(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`);
        return;
      }
      setNotice(`Saved ${entries.length} condition ${entries.length === 1 ? "score" : "scores"}.`);
      setScores({});
      setNotes({});
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {notice ? <p className="text-sm text-[var(--band-good)]">{notice}</p> : null}
      {assets.length === 0 ? (
        <p className="text-sm text-muted">No assets are listed at this site yet. Add the ones you are rating below.</p>
      ) : null}
      {open && assets.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-border bg-background p-3">
          <p className="text-sm font-medium text-foreground">Rate the condition of each asset</p>
          <ul className="space-y-2">
            {assets.map((a) => (
              <li key={a.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_14rem_1fr] sm:items-center">
                <span className="text-sm text-foreground">{a.name}</span>
                <select
                  aria-label={`Condition of ${a.name}`}
                  value={scores[a.id] ?? ""}
                  onChange={(e) => setScores((s) => ({ ...s, [a.id]: e.target.value }))}
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                >
                  <option value="">Not rated</option>
                  {BANDS.map((b) => (
                    <option key={b.score} value={b.score}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`Note for ${a.name}`}
                  value={notes[a.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                  placeholder="What you saw (optional)"
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-brand"
                />
              </li>
            ))}
          </ul>
          {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save condition scores"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {assets.length > 0 ? (
            <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
              Enter condition scores
            </Button>
          ) : null}
          <AddAssetForm jobId={jobId} siteId={siteId} />
        </div>
      )}
    </div>
  );
}

const ASSET_TYPES = [
  "HVAC rooftop unit",
  "Roof",
  "Parking lot",
  "Electrical",
  "Plumbing",
  "Fire / life safety",
  "Flooring",
  "Lighting",
  "Doors / storefront",
  "Signage",
  "Other",
];

/** An asset the site does not have listed yet, added so it can be rated. */
function AddAssetForm({ jobId, siteId }: { jobId: string; siteId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState(ASSET_TYPES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) {
      setError("Give the asset a name, e.g. RTU-05.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/capture-jobs/${jobId}/sites/${siteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-asset", name: name.trim(), assetType }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        setError(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`);
        return;
      }
      setName("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        + Add an asset
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-border bg-background p-3">
      <label className="block text-xs font-medium text-muted">
        Asset name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. RTU-05"
          className="mt-1 block rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-brand"
        />
      </label>
      <label className="block text-xs font-medium text-muted">
        Type
        <select
          value={assetType}
          onChange={(e) => setAssetType(e.target.value)}
          className="mt-1 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
        >
          {ASSET_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <Button type="button" disabled={busy} onClick={add}>
        {busy ? "Adding…" : "Add asset"}
      </Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error ? <p className="w-full text-sm text-[var(--band-critical)]">{error}</p> : null}
    </div>
  );
}
