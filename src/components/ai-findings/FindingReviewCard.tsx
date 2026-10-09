"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

export interface FindingView {
  id: string;
  label: string;
  defectClass: string | null;
  confidence: number | null;
  modelName: string | null;
  imageUrl: string;
  /** Fractions of the image, 0–1, from the top-left. */
  box: { x: number; y: number; w: number; h: number } | null;
  propertyName: string;
  foundAt: string;
  assetId: string | null;
  assets: Array<{ id: string; label: string }>;
  rule: { label: string; severity: string; costCents: number | null; penalty: number } | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  issue: { id: string; title: string } | null;
}

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand";

/**
 * One finding: the photo with the model's box drawn on it, the suggested
 * values from the organization's rule already filled in, and Confirm or
 * Reject. Whatever the inspector leaves in the fields is what gets recorded.
 */
export function FindingReviewCard({ finding }: { finding: FindingView }) {
  const router = useRouter();
  const r = finding.rule;
  const [severity, setSeverity] = useState(r?.severity ?? "");
  const [cost, setCost] = useState(r?.costCents != null ? String(r.costCents / 100) : "");
  const [penalty, setPenalty] = useState(r ? String(r.penalty) : "0");
  const [assetId, setAssetId] = useState(finding.assetId ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const changed =
    !!r && (severity !== r.severity || cost !== (r.costCents != null ? String(r.costCents / 100) : "") || penalty !== String(r.penalty));

  async function decide(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/v1/ai-findings/${finding.id}`, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  function confirm() {
    if (!severity) {
      setError("Choose a severity. There is no defect rule for this class to suggest one.");
      return;
    }
    const dollars = cost.trim() === "" ? null : Number(cost);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) {
      setError("Enter the repair cost as a number of dollars, or leave it blank.");
      return;
    }
    const points = Number(penalty);
    if (!Number.isInteger(points) || points < 0 || points > 100) {
      setError("The condition hit is a whole number of points from 0 to 100.");
      return;
    }
    void decide({
      action: "confirm",
      severity,
      repairCostCents: dollars === null ? null : Math.round(dollars * 100),
      conditionPenalty: points,
      assetId: assetId || null,
      note: note || null,
    });
  }

  return (
    <Card>
      <CardBody className="space-y-4 text-sm">
        <div className="relative overflow-hidden rounded-lg border border-border bg-background">
          {/* eslint-disable-next-line @next/next/no-img-element -- same-origin evidence bytes */}
          <img src={finding.imageUrl} alt={`Photo from ${finding.propertyName}`} className="block w-full" />
          {finding.box ? (
            <div
              className="pointer-events-none absolute rounded-sm border-[3px] shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
              style={{
                // A fixed amber, not a theme token: it is drawn on a photo,
                // whose colours do not change with the app's theme.
                borderColor: "#f59e0b",
                left: `${finding.box.x * 100}%`,
                top: `${finding.box.y * 100}%`,
                width: `${finding.box.w * 100}%`,
                height: `${finding.box.h * 100}%`,
              }}
            >
              <span className="absolute -top-6 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium text-black" style={{ background: "#f59e0b" }}>
                {finding.label}
                {finding.confidence !== null ? ` · ${Math.round(finding.confidence * 100)}%` : ""}
              </span>
            </div>
          ) : null}
        </div>

        <div>
          <p className="text-base font-semibold text-foreground">{finding.label}</p>
          <p className="text-xs text-muted">
            {finding.propertyName} · found {finding.foundAt}
            {finding.confidence !== null ? ` · model ${Math.round(finding.confidence * 100)}% sure` : ""}
            {finding.modelName ? ` · ${finding.modelName}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted">
            {r
              ? `Suggested by your rule "${r.label}". Change anything that does not match what you see.`
              : "No defect rule matches this class, so nothing is suggested. Fill in what you see."}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-muted">
            Severity
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputClass}>
              {!r ? <option value="">Choose…</option> : null}
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-muted">
            Repair cost estimate ($)
            <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Leave blank if unknown" className={inputClass} />
          </label>
          <label className="block text-xs font-medium text-muted">
            Condition hit (points off 100)
            <input inputMode="numeric" value={penalty} onChange={(e) => setPenalty(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-xs font-medium text-muted">
            Asset
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={inputClass}>
              <option value="">No specific asset</option>
              {finding.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-xs font-medium text-muted">
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you saw, or why you rejected it" className={inputClass} />
        </label>
        {changed ? <p className="text-xs text-muted">You changed the suggested values; yours will be used.</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={confirm}>
            {busy ? "Saving…" : "Confirm and create issue"}
          </Button>
          {!rejecting ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>
              Reject
            </Button>
          ) : (
            <>
              <Button type="button" variant="danger" disabled={busy} onClick={() => decide({ action: "reject", note: note || null })}>
                Yes, reject
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
                Keep
              </Button>
            </>
          )}
        </div>
        {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
      </CardBody>
    </Card>
  );
}
