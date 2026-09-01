"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

interface TargetFieldOption {
  key: string;
  label: string;
  required: boolean;
  help?: string;
}

interface PreviewRow {
  rowNumber: number;
  values: Record<string, string | number | null>;
  verdict: "NEW" | "NEEDS_REVIEW" | "DUPLICATE" | "ERROR";
  issues: Array<{ column: string | null; field: string | null; message: string }>;
  match?: { id: string; name: string; rule: string; confidence: number; detail: string };
  duplicateOfRow?: number;
}

interface Preview {
  headers: string[];
  mapping: Record<string, string>;
  unmappedHeaders: string[];
  missingRequired: string[];
  sheetName?: string;
  ignoredSheets?: string[];
  totals: { rows: number; ok: number; duplicates: number; needsReview: number; errors: number; skippedEmptyRows: number };
  rows: PreviewRow[];
}

export interface ImportJobSummary {
  id: string;
  entityType: string;
  status: string;
  originalFilename: string;
  rowCount: number;
  successCount: number;
  errorCount: number;
  duplicateCount: number;
  createdAt: string | Date;
  completedAt: string | Date | null;
  undoneAt: string | Date | null;
}

/**
 * The import wizard (spec §68). Deliberately four explicit steps —
 * upload, map, review, apply — because every requirement in §68 beyond
 * field mapping exists to answer "what is about to happen to my data?"
 * before it happens. A one-click import would satisfy none of them.
 */
export function ImportWizard({
  fields,
  portfolios,
  jobs,
}: {
  fields: Record<"PROPERTIES" | "ASSETS", TargetFieldOption[]>;
  portfolios: Array<{ id: string; name: string }>;
  jobs: ImportJobSummary[];
}) {
  const router = useRouter();
  const [entityType, setEntityType] = useState<"PROPERTIES" | "ASSETS">("PROPERTIES");
  const [portfolioId, setPortfolioId] = useState(portfolios[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<"SKIP" | "UPDATE">("SKIP");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: number } | null>(null);

  const targetFields = fields[entityType];

  async function run<T>(action: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(action);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function upload() {
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    body.append("entityType", entityType);
    if (entityType === "PROPERTIES" && portfolioId) body.append("targetPortfolioId", portfolioId);

    const job = await run("upload", () => apiFetch<{ id: string }>("/api/v1/imports", { method: "POST", body }));
    if (!job) return;
    setJobId(job.id);
    setResult(null);
    const next = await run("preview", () =>
      apiFetch<Preview>(`/api/v1/imports/${job.id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    if (next) setPreview(next);
  }

  async function repreview(mapping: Record<string, string>) {
    if (!jobId) return;
    const next = await run("preview", () =>
      apiFetch<Preview>(`/api/v1/imports/${jobId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping }),
      }),
    );
    if (next) setPreview(next);
  }

  async function commit() {
    if (!jobId) return;
    const outcome = await run("commit", () =>
      apiFetch<{ created: number; updated: number; skipped: number; errors: number }>(`/api/v1/imports/${jobId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicateStrategy, targetPortfolioId: portfolioId || null }),
      }),
    );
    if (outcome) {
      setResult(outcome);
      setPreview(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}

      <Card>
        <CardHeader title="1. Upload a file" subtitle="CSV, TSV, or Excel (.xlsx). Up to 5MB and 20,000 rows." />
        <CardBody className="space-y-3 text-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-muted">What are you importing?</label>
              <select
                value={entityType}
                onChange={(e) => {
                  setEntityType(e.target.value as "PROPERTIES" | "ASSETS");
                  setPreview(null);
                  setJobId(null);
                }}
                className="mt-1 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
              >
                <option value="PROPERTIES">Properties</option>
                <option value="ASSETS">Assets</option>
              </select>
            </div>

            {entityType === "PROPERTIES" ? (
              <div>
                <label className="block text-xs font-medium text-muted">Portfolio for new properties</label>
                <select
                  value={portfolioId}
                  onChange={(e) => setPortfolioId(e.target.value)}
                  className="mt-1 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
                >
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="pb-2 text-xs text-muted">Assets are linked to properties by ID or name — import properties first.</p>
            )}

            <div>
              <label className="block text-xs font-medium text-muted">File</label>
              <input
                type="file"
                accept=".csv,.tsv,.xlsx,.xlsm,.txt"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="mt-1 block text-sm"
              />
            </div>

            <Button onClick={upload} disabled={!file || busy !== null}>
              {busy === "upload" || busy === "preview" ? "Reading..." : "Upload and preview"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {preview ? (
        <>
          <Card>
            <CardHeader
              title="2. Match your columns"
              subtitle="We guessed from your headers. Check them — a wrong guess imports the wrong data."
            />
            <CardBody className="space-y-3 text-sm">
              {preview.sheetName ? (
                <p className="text-xs text-muted">
                  Reading sheet <span className="font-medium text-foreground">{preview.sheetName}</span>
                  {preview.ignoredSheets?.length ? ` — ignoring ${preview.ignoredSheets.join(", ")}` : ""}
                </p>
              ) : null}

              {preview.missingRequired.length > 0 ? (
                <p className="rounded-lg border border-[var(--band-critical)] bg-background px-3 py-2 text-xs text-[var(--band-critical)]">
                  Required fields with no column: {preview.missingRequired.join(", ")}
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {preview.headers.map((header) => (
                  <div key={header} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 truncate font-mono text-xs text-muted" title={header}>
                      {header}
                    </span>
                    <span className="text-muted">→</span>
                    <select
                      value={preview.mapping[header] ?? ""}
                      onChange={(e) => {
                        const next = { ...preview.mapping };
                        if (e.target.value === "") delete next[header];
                        else next[header] = e.target.value;
                        setPreview({ ...preview, mapping: next });
                        repreview(next);
                      }}
                      className="flex-1 rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:border-brand"
                    >
                      <option value="">Ignore this column</option>
                      {targetFields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                          {f.required ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="3. Review what will happen" subtitle="Nothing has been written yet." />
            <CardBody className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-4">
                <Tally label="Rows" value={preview.totals.rows} />
                <Tally label="Will be created" value={preview.totals.ok} tone="good" />
                <Tally label="Duplicates" value={preview.totals.duplicates} tone={preview.totals.duplicates ? "warn" : undefined} />
                <Tally label="Need review" value={preview.totals.needsReview} tone={preview.totals.needsReview ? "warn" : undefined} />
                <Tally label="Errors" value={preview.totals.errors} tone={preview.totals.errors ? "bad" : undefined} />
              </div>

              {preview.totals.errors > 0 && jobId ? (
                <a href={`/api/v1/imports/${jobId}/errors`} className="inline-block text-xs text-brand underline">
                  Download the error report (CSV)
                </a>
              ) : null}

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="border-b border-border bg-background text-left text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Outcome</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 50).map((row) => (
                      <tr key={row.rowNumber} className="border-b border-border last:border-0">
                        <td className="px-3 py-1.5 tabular-nums text-muted">{row.rowNumber}</td>
                        <td className={`px-3 py-1.5 font-medium ${verdictTone(row.verdict)}`}>{verdictLabel(row.verdict)}</td>
                        <td className="px-3 py-1.5 text-foreground">{String(row.values.name ?? "—")}</td>
                        <td className="px-3 py-1.5 text-muted">
                          {row.issues.length > 0
                            ? row.issues.map((i) => `${i.column ?? i.field}: ${i.message}`).join("; ")
                            : row.duplicateOfRow
                              ? `Same as row ${row.duplicateOfRow} in this file`
                              : (row.match?.detail ?? "New record")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.totals.rows > preview.rows.length ? (
                <p className="text-xs text-muted">
                  Showing the first {preview.rows.length} of {preview.totals.rows} rows. The totals above cover the whole file.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="4. Apply" subtitle="Applied in one transaction — all of it lands, or none of it does." />
            <CardBody className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-muted">Rows that match something that already exists</label>
                <select
                  value={duplicateStrategy}
                  onChange={(e) => setDuplicateStrategy(e.target.value as "SKIP" | "UPDATE")}
                  className="mt-1 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
                >
                  <option value="SKIP">Skip them — leave existing records untouched</option>
                  <option value="UPDATE">Update the existing record with the file&apos;s values</option>
                </select>
              </div>
              <Button onClick={commit} disabled={busy !== null || preview.missingRequired.length > 0}>
                {busy === "commit" ? "Importing..." : `Import ${preview.totals.ok + (duplicateStrategy === "UPDATE" ? preview.totals.duplicates : 0)} rows`}
              </Button>
              {preview.missingRequired.length > 0 ? (
                <p className="text-xs text-muted">Map the required fields above before importing.</p>
              ) : null}
            </CardBody>
          </Card>
        </>
      ) : null}

      {result ? (
        <Card>
          <CardHeader title="Import complete" />
          <CardBody className="flex flex-wrap gap-4 text-sm">
            <Tally label="Created" value={result.created} tone="good" />
            <Tally label="Updated" value={result.updated} tone="good" />
            <Tally label="Skipped" value={result.skipped} />
            <Tally label="Errors" value={result.errors} tone={result.errors ? "bad" : undefined} />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Import history" subtitle="A completed import can be undone." />
        <CardBody className="p-0 text-sm">
          {jobs.length === 0 ? (
            <p className="p-4 text-muted">Nothing has been imported yet.</p>
          ) : (
            <ul>
              {jobs.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 last:border-0">
                  <div>
                    <p className="font-medium text-foreground">
                      {job.originalFilename}{" "}
                      <span className="text-xs font-normal text-muted">({job.entityType.toLowerCase()})</span>
                    </p>
                    <p className="text-xs text-muted">
                      {formatDateTime(job.createdAt)} · {job.successCount} applied · {job.duplicateCount} skipped ·{" "}
                      {job.errorCount} errors
                      {job.undoneAt ? ` · undone ${formatDateTime(job.undoneAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${statusTone(job.status)}`}>{job.status}</span>
                    {job.status === "COMPLETED" ? (
                      <Button
                        variant="ghost"
                        disabled={busy === `undo-${job.id}`}
                        onClick={() =>
                          run(`undo-${job.id}`, () =>
                            apiFetch(`/api/v1/imports/${job.id}/rollback`, { method: "POST" }),
                          ).then(() => router.refresh())
                        }
                      >
                        {busy === `undo-${job.id}` ? "Undoing..." : "Undo"}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Tally({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" | "bad" }) {
  const color =
    tone === "good" ? "text-[var(--band-good)]" : tone === "warn" ? "text-[var(--band-needs-attention)]" : tone === "bad" ? "text-[var(--band-critical)]" : "text-foreground";
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function verdictLabel(verdict: PreviewRow["verdict"]): string {
  return verdict === "NEW" ? "Create" : verdict === "DUPLICATE" ? "Duplicate" : verdict === "NEEDS_REVIEW" ? "Needs review" : "Error";
}

function verdictTone(verdict: PreviewRow["verdict"]): string {
  if (verdict === "NEW") return "text-[var(--band-good)]";
  if (verdict === "ERROR") return "text-[var(--band-critical)]";
  return "text-[var(--band-needs-attention)]";
}

function statusTone(status: string): string {
  if (status === "COMPLETED") return "text-[var(--band-good)]";
  if (status === "FAILED") return "text-[var(--band-critical)]";
  if (status === "ROLLED_BACK") return "text-muted";
  return "text-[var(--band-needs-attention)]";
}
