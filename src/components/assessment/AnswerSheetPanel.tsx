"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

interface RowResult {
  rowNumber: number;
  status: "save" | "skip" | "error";
  message: string;
}
interface ImportResult {
  applied: boolean;
  saved: number;
  skipped: number;
  errors: number;
  rows: RowResult[];
}

/**
 * Spreadsheet round trip for one assessment: download it, fill the Answer
 * column offline, check the file, then load it. Checking is a dry run, so
 * nothing is written until the file is clean and someone presses Load.
 */
export function AnswerSheetPanel({ assessmentId, canImport }: { assessmentId: string; canImport: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"check" | "load" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(dryRun ? "check" : "load");
    setError(null);
    const body = new FormData();
    body.append("file", file);
    body.append("dryRun", String(dryRun));
    try {
      const res = await fetch(`/api/v1/assessments/${assessmentId}/import`, { method: "POST", body });
      const payload = (await res.json().catch(() => null)) as { data?: ImportResult; error?: string } | null;
      if (!res.ok || !payload?.data) {
        setError(payload?.error ?? `Request failed (${res.status})`);
        setResult(null);
      } else {
        setResult(payload.data);
        if (payload.data.applied) router.refresh();
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const problems = result?.rows.filter((r) => r.status === "error") ?? [];

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Spreadsheet</h3>
          <p className="text-xs text-muted">
            Download the survey, fill the Answer column offline, and load it back. Copy a repeatable task&apos;s rows with the next
            Response # to add another.
          </p>
        </div>
        <a
          href={`/api/v1/assessments/${assessmentId}/export`}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-zinc-50"
        >
          Download CSV
        </a>
      </div>

      {canImport ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".csv,.tsv,.xlsx"
            aria-label="Filled-in answer sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
            className="text-sm"
          />
          <Button variant="secondary" disabled={!file || busy !== null} onClick={() => send(true)}>
            {busy === "check" ? "Checking..." : "Check file"}
          </Button>
          {result && !result.applied && result.errors === 0 && result.saved > 0 ? (
            <Button disabled={busy !== null} onClick={() => send(false)}>
              {busy === "load" ? "Loading..." : `Load ${result.saved} answer${result.saved === 1 ? "" : "s"}`}
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}

      {result ? (
        <div className="space-y-2 text-sm">
          <p className={result.errors ? "text-[var(--band-critical)]" : "text-foreground"}>
            {result.applied
              ? `Loaded ${result.saved} answer${result.saved === 1 ? "" : "s"}; ${result.skipped} row${result.skipped === 1 ? "" : "s"} left as they were.`
              : result.errors
                ? `${result.errors} row${result.errors === 1 ? " needs" : "s need"} fixing before anything is loaded.`
                : result.saved === 0
                  ? "Nothing to load: every row is blank or a photo."
                  : `Ready: ${result.saved} answer${result.saved === 1 ? "" : "s"} to load, ${result.skipped} blank or photo row${result.skipped === 1 ? "" : "s"} skipped.`}
          </p>
          {problems.length > 0 ? (
            <ul className="max-h-48 space-y-0.5 overflow-auto rounded-lg border border-border p-2 text-xs">
              {problems.map((r) => (
                <li key={r.rowNumber}>
                  <span className="font-medium text-foreground">Row {r.rowNumber}:</span> <span className="text-muted">{r.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
