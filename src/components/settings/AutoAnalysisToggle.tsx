"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The organization's switch for analysing vendor photos automatically on
 * upload. Off still leaves the manual "Analyse with AI" button on every photo.
 */
export function AutoAnalysisToggle({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/photo-analysis/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoAnalyzePhotos: !enabled }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setError(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Analyse vendor photos automatically</p>
          <p className="mt-1 text-sm text-muted">
            When a vendor uploads photos on a capture job and says which asset they show, the AI analyses them straight
            away, so a suggestion is waiting for review. Each photo is one paid AI request. Suggestions still need a
            person to confirm them before any score or cost changes.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Analyse vendor photos automatically"
          disabled={!canEdit || busy}
          onClick={toggle}
          className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
            enabled ? "bg-brand" : "bg-zinc-300"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${enabled ? "translate-x-5" : "translate-x-0.5"}`}
          />
        </button>
      </div>
      <p className="mt-2 text-xs font-medium text-foreground">{enabled ? "On" : "Off"}</p>
      {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
