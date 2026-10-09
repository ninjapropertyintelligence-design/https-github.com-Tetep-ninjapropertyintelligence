"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Defect {
  label: string;
  severity: string;
  location: string;
}

export interface PhotoFinding {
  id: string;
  status: string;
  label: string;
  description: string | null;
  suggestedScore: number | null;
  suggestedSeverity: string | null;
  confidence: number | null;
  defects: Defect[];
  recommendedAction: string | null;
  confirmedScore: number | null;
  assetName: string | null;
}

export interface SitePhoto {
  id: string;
  assetId: string | null;
  label: string;
  findings: PhotoFinding[];
}

const SEVERITY_STYLE: Record<string, string> = {
  LOW: "border-zinc-200 bg-zinc-50 text-zinc-600",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-700",
  HIGH: "border-orange-200 bg-orange-50 text-orange-700",
  CRITICAL: "border-red-200 bg-red-50 text-red-700",
};

/**
 * AI photo analysis on a capture-job site: the AI suggests, a person confirms.
 *
 * The suggestion is shown with its confidence and the defects behind it, and
 * the score field is pre-filled but editable, so confirming is a judgement
 * rather than a click-through. Nothing changes the asset until Confirm.
 */
export function AIPhotoReviewPanel({
  photos,
  assets,
  disabled,
}: {
  photos: SitePhoto[];
  assets: Array<{ id: string; name: string }>;
  disabled: boolean;
}) {
  if (photos.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">AI photo analysis</p>
      <p className="mt-0.5 text-xs text-muted">
        The AI suggests a condition rating from each photo. It only counts once you confirm it.
      </p>
      <ul className="mt-2 space-y-3">
        {photos.map((photo) => (
          <PhotoRow key={photo.id} photo={photo} assets={assets} disabled={disabled} />
        ))}
      </ul>
    </div>
  );
}

function PhotoRow({
  photo,
  assets,
  disabled,
}: {
  photo: SitePhoto;
  assets: Array<{ id: string; name: string }>;
  disabled: boolean;
}) {
  const router = useRouter();
  const pending = photo.findings.find((f) => f.status === "SUGGESTED") ?? null;
  const reviewed = photo.findings.filter((f) => f.status !== "SUGGESTED");

  const [assetId, setAssetId] = useState(photo.assetId ?? "");
  const [score, setScore] = useState(pending?.suggestedScore?.toString() ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(url: string, body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        // `error` in this API's envelope is a string — see CaptureSiteActions.
        setError(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`);
        return;
      }
      setNote("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const scoreValue = score.trim() === "" ? null : Number(score);
  const scoreValid = scoreValue !== null && Number.isInteger(scoreValue) && scoreValue >= 0 && scoreValue <= 100;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row">
      {/* eslint-disable-next-line @next/next/no-img-element -- tenant-scoped bytes from our own route, not a static asset */}
      <img
        src={`/api/v1/evidence/${photo.id}/content`}
        alt={photo.label}
        className="h-28 w-full shrink-0 rounded-md border border-border object-cover sm:w-40"
        loading="lazy"
      />

      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <p className="truncate text-xs text-muted">{photo.label}</p>

        {pending ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{pending.label}</span>
              {pending.suggestedSeverity ? (
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    SEVERITY_STYLE[pending.suggestedSeverity] ?? SEVERITY_STYLE.LOW
                  }`}
                >
                  {pending.suggestedSeverity.toLowerCase()}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-muted">
              {pending.assetName ?? "Unknown asset"} · AI suggests{" "}
              <span className="font-semibold text-foreground">
                {pending.suggestedScore ?? "no score"}
                {pending.suggestedScore !== null ? "/100" : ""}
              </span>
              {pending.confidence !== null ? ` · ${Math.round(pending.confidence * 100)}% confident` : ""}
            </p>
            {pending.description ? <p className="text-foreground">{pending.description}</p> : null}
            {pending.defects.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-foreground">
                {pending.defects.map((d, i) => (
                  <li key={i}>
                    {d.label} <span className="text-muted">({d.severity.toLowerCase()}, {d.location})</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {pending.recommendedAction ? (
              <p className="text-xs text-muted">Recommended: {pending.recommendedAction}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className="flex items-center gap-1.5 text-xs text-muted">
                Score
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground outline-none focus:border-brand"
                />
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note (optional)"
                className="min-w-40 flex-1 rounded-lg border border-border bg-surface px-3 py-1 text-sm text-foreground outline-none focus:border-brand"
              />
              <button
                type="button"
                disabled={disabled || busy !== null || !scoreValid}
                onClick={() =>
                  post(`/api/v1/ai-findings/${pending.id}/review`, { decision: "confirm", score: scoreValue, note }, "confirm")
                }
                className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {busy === "confirm" ? "Confirming…" : "Confirm"}
              </button>
              <button
                type="button"
                disabled={disabled || busy !== null}
                onClick={() => post(`/api/v1/ai-findings/${pending.id}/review`, { decision: "reject", note }, "reject")}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-background disabled:opacity-50"
              >
                {busy === "reject" ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              disabled={disabled || busy !== null}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
            >
              <option value="">Which asset is this?</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={disabled || busy !== null || !assetId}
              onClick={() => post(`/api/v1/evidence/${photo.id}/analyze`, { assetId }, "analyze")}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy === "analyze" ? "Analysing…" : "Analyse with AI"}
            </button>
          </div>
        )}

        {reviewed.length > 0 ? (
          <ul className="space-y-0.5 text-xs text-muted">
            {reviewed.map((f) => (
              <li key={f.id}>
                {f.status === "REJECTED"
                  ? `Rejected: ${f.label}`
                  : `Confirmed ${f.confirmedScore}/100 for ${f.assetName ?? "asset"}` +
                    (f.suggestedScore !== null && f.confirmedScore !== f.suggestedScore
                      ? ` (AI suggested ${f.suggestedScore})`
                      : "")}
              </li>
            ))}
          </ul>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </li>
  );
}
