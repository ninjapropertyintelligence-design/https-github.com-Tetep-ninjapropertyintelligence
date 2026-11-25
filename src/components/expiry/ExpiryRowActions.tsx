"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

/** Confirm a date read from a photo, renew when the tag is replaced, or stop counting down. */
export function ExpiryRowActions({
  id,
  kind,
  needsReview,
  expiresOn,
}: {
  id: string;
  kind: string;
  needsReview: boolean;
  /** The current expiry, "YYYY-MM-DD": a renewal must be later than it. */
  expiresOn: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    const res = await apiRequest(url, init);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {needsReview ? (
          <Button variant="secondary" disabled={busy} onClick={() => call(`/api/v1/expiries/${id}`, { method: "PATCH", body: JSON.stringify({ confirmed: true }) })}>
            Looks right
          </Button>
        ) : null}
        <Button variant="ghost" disabled={busy} onClick={() => setRenewing((r) => !r)}>
          Renew
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            if (window.confirm(`Stop counting down "${kind}"? Use this when it no longer applies.`)) {
              await call(`/api/v1/expiries/${id}`, { method: "DELETE" });
            }
          }}
        >
          Dismiss
        </Button>
      </div>
      {renewing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call(`/api/v1/expiries/${id}/renew`, { method: "POST", body: JSON.stringify({ expiresAt: date }) })) setRenewing(false);
          }}
        >
          <input required type="date" min={expiresOn} value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-border px-2 py-1 text-sm" />
          <Button type="submit" disabled={busy || !date}>
            Save new date
          </Button>
        </form>
      ) : null}
      {error ? <p className="text-xs text-[var(--band-critical)]">{error}</p> : null}
    </div>
  );
}
