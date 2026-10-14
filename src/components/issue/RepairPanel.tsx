"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

export interface RepairPhoto {
  id: string;
  stage: "BEFORE" | "AFTER";
  url: string;
  takenAt: string;
  /** After-photos older than the last send-back no longer count as proof. */
  superseded: boolean;
}

export interface RepairView {
  issueId: string;
  propertyId: string;
  status: string;
  repairerLabel: string | null;
  notes: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  sentBackReason: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  actualCostDollars: string | null;
  asset: { name: string; conditionScore: number | null } | null;
  photos: RepairPhoto[];
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand";

/**
 * The repair, on the issue it fixes: who is doing it, the before and after
 * photos, and the one next step that belongs to whoever is looking.
 *
 * - The repairer starts work, adds photos, and marks it done with notes and
 *   the actual cost. Done needs a new after-photo; the server says so if not.
 * - A manager of the building checks it: accepts, optionally recording the
 *   asset's condition after the fix, or sends it back with what to fix.
 * The server decides who may do what; this only shows the step that applies.
 */
export function RepairPanel({
  repair,
  isRepairer,
  canVerify,
  canUpload,
}: {
  repair: RepairView;
  isRepairer: boolean;
  canVerify: boolean;
  canUpload: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(repair.notes ?? "");
  const [cost, setCost] = useState(repair.actualCostDollars ?? "");
  const [score, setScore] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState("");

  const open = ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"].includes(repair.status);
  const waiting = repair.status === "RESOLVED";
  const done = repair.status === "VERIFIED" || repair.status === "CLOSED";

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/v1/issues/${repair.issueId}/repair`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  async function upload(stage: "BEFORE" | "AFTER", files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const contentType = file.type || "application/octet-stream";
        const signed = await apiRequest("/api/v1/evidence/upload-url", {
          method: "POST",
          body: JSON.stringify({ filename: file.name, contentType }),
        });
        if (!signed.ok) throw new Error(signed.error);
        const { url, key } = signed.data as { url: string; key: string };
        const put = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
        if (!put.ok) throw new Error(`Storage refused ${file.name} (HTTP ${put.status})`);
        const registered = await apiRequest("/api/v1/evidence", {
          method: "POST",
          body: JSON.stringify({
            type: "PHOTO",
            storageKey: key,
            mimeType: contentType,
            sizeBytes: file.size,
            propertyId: repair.propertyId,
            issueId: repair.issueId,
            repairStage: stage,
            captureDate: new Date(file.lastModified).toISOString(),
          }),
        });
        if (!registered.ok) throw new Error(registered.error);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const dollars = cost.trim() === "" ? null : Number(cost);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) {
      setError("Enter the actual cost as a number, or leave it blank.");
      return;
    }
    await act({ action: "submit", notes, actualCost: dollars === null ? null : Math.round(dollars * 100) });
  }

  async function verify() {
    const n = score.trim() === "" ? null : Number(score);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 100)) {
      setError("Condition is a whole number from 0 to 100, or leave it blank.");
      return;
    }
    await act({ action: "verify", conditionScore: n });
  }

  const before = repair.photos.filter((p) => p.stage === "BEFORE");
  const after = repair.photos.filter((p) => p.stage === "AFTER");

  return (
    <Card>
      <CardHeader
        title="Repair"
        subtitle={repair.repairerLabel ? `Assigned to ${repair.repairerLabel}` : "Nobody has been sent to fix this yet"}
      />
      <CardBody className="space-y-4 text-sm">
        <Steps status={repair.status} />

        {repair.sentBackReason && open ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
            <p className="font-medium">Sent back</p>
            <p className="mt-0.5">{repair.sentBackReason}</p>
          </div>
        ) : null}

        {repair.notes && (waiting || done) ? (
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">
              What was done{repair.submittedBy ? ` — ${repair.submittedBy}` : ""}
              {repair.submittedAt ? `, ${repair.submittedAt}` : ""}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-foreground">{repair.notes}</p>
            {repair.actualCostDollars ? <p className="mt-1 text-xs text-muted">Actual cost: ${repair.actualCostDollars}</p> : null}
          </div>
        ) : null}

        {done && repair.verifiedBy ? (
          <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-800">
            Checked and accepted by {repair.verifiedBy}
            {repair.verifiedAt ? ` on ${repair.verifiedAt}` : ""}.
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PhotoColumn
            title="Before"
            photos={before}
            canAdd={canUpload && !done}
            busy={busy}
            onAdd={(files) => upload("BEFORE", files)}
          />
          <PhotoColumn
            title="After"
            photos={after}
            canAdd={canUpload && !done}
            busy={busy}
            onAdd={(files) => upload("AFTER", files)}
          />
        </div>

        {isRepairer && open ? (
          <form onSubmit={submit} className="space-y-3 rounded-lg border border-border p-3">
            {repair.status !== "IN_PROGRESS" ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => act({ action: "start" })}>
                Start work
              </Button>
            ) : null}
            <label className="block text-xs font-medium text-muted">
              What did you do?
              <textarea
                required
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Replaced 4 m² of membrane around the north-east drain and resealed the flashing."
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <label className="block text-xs font-medium text-muted">
              Actual cost ($, optional)
              <input
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <Button type="submit" disabled={busy || notes.trim() === ""}>
              {busy ? "Saving…" : "Repair done — send for checking"}
            </Button>
            <p className="text-xs text-muted">Needs at least one after-photo.</p>
          </form>
        ) : null}

        {isRepairer && waiting ? <p className="text-muted">Done — waiting for a manager to check it.</p> : null}

        {canVerify && !isRepairer && waiting ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="font-medium text-foreground">Check this repair</p>
            {repair.asset ? (
              <label className="block text-xs font-medium text-muted">
                Condition of {repair.asset.name} after the repair (0–100, optional
                {repair.asset.conditionScore !== null ? `; currently ${repair.asset.conditionScore}` : ""})
                <input
                  inputMode="numeric"
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  className={`mt-1 ${inputClass}`}
                />
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={verify}>
                Accept repair
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setSendingBack((v) => !v)}>
                Send back
              </Button>
            </div>
            {sendingBack ? (
              <div className="flex flex-wrap gap-2">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="What still needs fixing?"
                  className={`min-w-56 flex-1 ${inputClass}`}
                />
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy || reason.trim() === ""}
                  onClick={async () => {
                    if (await act({ action: "send_back", reason })) {
                      setSendingBack(false);
                      setReason("");
                    }
                  }}
                >
                  Send back
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
      </CardBody>
    </Card>
  );
}

const STEPS = [
  { key: "ASSIGNED", label: "Assigned" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "RESOLVED", label: "Waiting to be checked" },
  { key: "VERIFIED", label: "Accepted" },
];

function Steps({ status }: { status: string }) {
  const order = ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "VERIFIED", "CLOSED"];
  const at = order.indexOf(status);
  return (
    <ol className="flex flex-wrap gap-1.5">
      {STEPS.map((step) => {
        const reached = at >= order.indexOf(step.key);
        const current = status === step.key || (step.key === "VERIFIED" && status === "CLOSED");
        return (
          <li
            key={step.key}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${
              current
                ? "border-brand bg-brand text-white"
                : reached
                  ? "border-green-200 bg-green-50 text-green-700"
                  : "border-border text-muted"
            }`}
          >
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

function PhotoColumn({
  title,
  photos,
  canAdd,
  busy,
  onAdd,
}: {
  title: string;
  photos: RepairPhoto[];
  canAdd: boolean;
  busy: boolean;
  onAdd: (files: FileList | null) => void;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted">
          {title} ({photos.length})
        </p>
        {canAdd ? (
          <label className={`cursor-pointer text-xs font-medium text-brand ${busy ? "pointer-events-none opacity-50" : ""}`}>
            + Add photos
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                onAdd(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        ) : null}
      </div>
      {photos.length === 0 ? (
        <p className="text-xs text-muted">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {photos.map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="relative block">
              {/* eslint-disable-next-line @next/next/no-img-element -- same-origin evidence bytes, not a static asset */}
              <img
                src={p.url}
                alt={`${title} photo, ${p.takenAt}`}
                className={`aspect-square w-full rounded-md object-cover ${p.superseded ? "opacity-40" : ""}`}
              />
              {p.superseded ? (
                <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-black/60 px-1 text-[10px] text-white">
                  before send-back
                </span>
              ) : null}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
