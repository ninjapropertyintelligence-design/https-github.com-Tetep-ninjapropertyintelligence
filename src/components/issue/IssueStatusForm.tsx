"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

const STATUSES = ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "VERIFIED", "CLOSED"];

export function IssueStatusForm({ issueId, currentStatus, version }: { issueId: string; currentStatus: string; version: number }) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/v1/issues/${issueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, version }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to update status");
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-border px-3 py-1.5 text-sm">
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={loading || status === currentStatus} variant="secondary">
        {loading ? "Saving..." : "Update status"}
      </Button>
      {error ? <span className="text-sm text-[var(--band-critical)]">{error}</span> : null}
    </form>
  );
}
