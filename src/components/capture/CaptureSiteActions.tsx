"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The two ends of a site's lifecycle: the vendor submitting it, and the
 * ordering organization accepting or sending it back.
 *
 * Submit is deliberately not disabled when deliverables are outstanding. The
 * server refuses and names what is missing, and a vendor who can press the
 * button and be told "this site still owes drone, condition scores" learns
 * more than one staring at a greyed-out control.
 */
export function CaptureSiteActions({
  jobId,
  siteId,
  status,
  jobStatus,
  missingCount,
  isVendor,
}: {
  jobId: string;
  siteId: string;
  status: string;
  jobStatus: string;
  missingCount: number;
  isVendor: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const jobOpen = ["ISSUED", "SUBMITTED", "REJECTED"].includes(jobStatus);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/capture-jobs/${jobId}/sites/${siteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        // The server's message names what is missing or why it was refused —
        // "this site still owes drone, condition scores". Replacing it with
        // "Something went wrong" throws away the only useful part.
        //
        // `error` in this API's envelope is a STRING, not an object. Reading
        // `.error.message` here silently yielded undefined and fell through
        // to the generic status line, which is how this shipped useless the
        // first time.
        const message = typeof payload?.error === "string" ? payload.error : null;
        setError(message ?? `Request failed (${res.status})`);
        return;
      }
      setRejecting(false);
      setReason("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "ACCEPTED" || !jobOpen) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {isVendor && status !== "SUBMITTED" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act({ action: "submit" })}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Submit site"}
          </button>
        ) : null}

        {isVendor && status === "SUBMITTED" ? (
          <span className="text-sm text-muted">Delivered — waiting on review.</span>
        ) : null}

        {!isVendor && status === "SUBMITTED" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => act({ action: "review", accept: true })}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting((v) => !v)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-background"
            >
              Send back
            </button>
          </>
        ) : null}

        {isVendor && missingCount > 0 ? (
          <span className="text-xs text-muted">
            {missingCount} {missingCount === 1 ? "deliverable" : "deliverables"} outstanding
          </span>
        ) : null}
      </div>

      {rejecting ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What does the vendor need to fix?"
            className="min-w-64 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={busy || reason.trim().length === 0}
            onClick={() => act({ action: "review", accept: false, reason })}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Send back
          </button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
