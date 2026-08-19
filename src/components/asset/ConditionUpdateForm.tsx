"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function ConditionUpdateForm({ assetId, currentScore, version }: { assetId: string; currentScore: number | null; version: number }) {
  const router = useRouter();
  const [score, setScore] = useState(currentScore ?? 75);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/v1/assets/${assetId}/condition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newScore: score, reason: reason || undefined }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to update condition");
      return;
    }
    setReason("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-muted">New condition score (0-100)</label>
        <input
          type="range"
          min={0}
          max={100}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          className="mt-1 w-full"
        />
        <p className="text-sm tabular-nums text-foreground">{score}</p>
      </div>
      <div>
        <label className="block text-xs font-medium text-muted">Reason / evidence note</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Observed during site walkthrough"
          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
      <Button type="submit" disabled={loading}>
        {loading ? "Saving..." : "Save condition change"}
      </Button>
      <p className="text-xs text-muted">Version {version} — this creates a new history entry, it never overwrites the old one.</p>
    </form>
  );
}
