"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCents } from "@/lib/format";

interface Rule {
  defectClass: string;
  category: string;
  defaultSeverity: string;
  conditionHit: number;
  /** Null when no estimate has been set. */
  repairCostCents: number | null;
  source?: "platform" | "organization";
}

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const SEVERITY_STYLE: Record<string, string> = {
  LOW: "border-zinc-200 bg-zinc-50 text-zinc-600",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-700",
  HIGH: "border-orange-200 bg-orange-50 text-orange-700",
  CRITICAL: "border-red-200 bg-red-50 text-red-700",
};

const CATEGORY_LABEL: Record<string, string> = {
  FireLifeSafety: "Fire / life safety",
  ExteriorParking: "Exterior / parking",
};

/**
 * One column template shared by the header and every row, so they line up.
 * Below `md` the rows become two-column cards with their own labels instead
 * of a table you would have to scroll sideways to read.
 */
const GRID = "md:grid-cols-[minmax(11rem,1.5fr)_minmax(7rem,1fr)_6.5rem_5rem_7.5rem_minmax(8rem,1.2fr)_9.5rem]";

/** The label a cell carries on a phone, where there is no header row. */
function CellLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-muted md:hidden">{children}</span>;
}

const inputClass =
  "rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground outline-none focus:border-brand";

function humanize(defectClass: string): string {
  const words = defectClass.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What someone types into "defect class" → the snake_case key detectors use. */
function toClassKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Dollars as typed → whole cents. Empty is a valid answer — "no estimate" —
 * so it is null; anything that is not an amount is "invalid".
 */
function dollarsToCents(value: string): number | null | "invalid" {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : "invalid";
}

const centsToInput = (cents: number | null) => (cents === null ? "" : String(cents / 100));

/** An estimate, or a visible "Not set" — never a blank that reads like $0. */
function Estimate({ cents }: { cents: number | null }) {
  return cents === null ? <span className="font-normal text-amber-700">Not set</span> : <>{formatCents(cents)}</>;
}

async function send(method: "PUT" | "DELETE", body?: Rule, defectClass?: string): Promise<string | null> {
  try {
    const res = await fetch(
      method === "DELETE" ? `/api/v1/defect-rules?defectClass=${encodeURIComponent(defectClass ?? "")}` : "/api/v1/defect-rules",
      {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    if (res.ok) return null;
    const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
    // `error` in this API's envelope is a string.
    return typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`;
  } catch {
    return "Could not reach the server. Check your connection and try again.";
  }
}

/**
 * Edits the organization's defect rulebook.
 *
 * Three kinds of row, and the actions differ: a platform default can be
 * customized; a customized default can be reset back; a class the
 * organization added itself can be deleted. Every change goes through the
 * same API the server validates, so the form never has to be the guard.
 */
export function DefectRulesManager({
  rules,
  defaults,
  categories,
  canEdit,
}: {
  rules: Rule[];
  defaults: Rule[];
  categories: readonly string[];
  canEdit: boolean;
}) {
  const defaultByClass = new Map(defaults.map((d) => [d.defectClass, d]));

  return (
    <div className="max-w-5xl space-y-4">
      {!canEdit ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          You can view these rules. Only an Owner or Portfolio Admin can change them.
        </p>
      ) : null}

      <div className="rounded-xl border border-border bg-surface" role="table" aria-label="Defect rules">
        <div
          role="row"
          className={`hidden border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted md:grid md:gap-3 ${GRID}`}
        >
          <span role="columnheader">Defect</span>
          <span role="columnheader">Category</span>
          <span role="columnheader">Severity</span>
          <span role="columnheader" className="text-right">
            Condition
          </span>
          <span role="columnheader" className="text-right">
            Repair estimate
          </span>
          <span role="columnheader">Source</span>
          <span role="columnheader" className="sr-only">
            Actions
          </span>
        </div>
        {rules.map((rule) => (
          <RuleRow
            key={rule.defectClass}
            rule={rule}
            platformDefault={defaultByClass.get(rule.defectClass) ?? null}
            categories={categories}
            canEdit={canEdit}
          />
        ))}
      </div>

      {canEdit ? <AddRuleForm categories={categories} existing={new Set(rules.map((r) => r.defectClass))} /> : null}

      <p className="text-xs leading-relaxed text-muted">
        The platform sets no repair estimates: there is no single price for a repair that holds across regions,
        buildings and contracts, and an invented one would appear in capital exposure as if it were real. Enter
        figures from your own contracts, quotes or past invoices. Until you do, confirmed findings open issues with no
        estimate. The condition points are starting defaults, not an industry standard; adjust them to your own
        judgement. Class names are the labels a detector reports, so a custom class only matches findings once your
        detector uses the same name.
      </p>
    </div>
  );
}

function RuleRow({
  rule,
  platformDefault,
  categories,
  canEdit,
}: {
  rule: Rule;
  platformDefault: Rule | null;
  categories: readonly string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState(rule.category);
  const [severity, setSeverity] = useState(rule.defaultSeverity);
  const [hit, setHit] = useState(String(rule.conditionHit));
  const [cost, setCost] = useState(centsToInput(rule.repairCostCents));

  const customized = rule.source === "organization" && platformDefault !== null;
  const customClass = rule.source === "organization" && platformDefault === null;

  const hitValue = Number(hit);
  const hitValid = hit.trim() !== "" && Number.isInteger(hitValue) && hitValue >= 0 && hitValue <= 100;
  const costCents = dollarsToCents(cost);

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const message = await action();
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  function startEditing() {
    setCategory(rule.category);
    setSeverity(rule.defaultSeverity);
    setHit(String(rule.conditionHit));
    setCost(centsToInput(rule.repairCostCents));
    setError(null);
    setEditing(true);
  }

  return (
    <div role="row" className="border-b border-border px-4 py-3 last:border-0">
      <div className={`grid grid-cols-2 items-start gap-x-3 gap-y-2.5 md:gap-y-0 ${GRID}`}>
        <div role="cell" className="col-span-2 min-w-0 md:col-span-1">
          <p className="font-medium text-foreground">{humanize(rule.defectClass)}</p>
          <p className="truncate font-mono text-xs text-muted">{rule.defectClass}</p>
        </div>

        {editing ? (
          <>
            <div role="cell">
              <CellLabel>Category</CellLabel>
              <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputClass} w-full`}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c] ?? c}
                  </option>
                ))}
              </select>
            </div>
            <div role="cell">
              <CellLabel>Severity</CellLabel>
              <select aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)} className={`${inputClass} w-full`}>
                {SEVERITIES.map((sev) => (
                  <option key={sev} value={sev}>
                    {sev.toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div role="cell" className="md:text-right">
              <CellLabel>Condition points off</CellLabel>
              <input
                aria-label="Condition points"
                type="number"
                min={0}
                max={100}
                value={hit}
                onChange={(e) => setHit(e.target.value)}
                className={`${inputClass} w-full md:text-right`}
              />
            </div>
            <div role="cell" className="md:text-right">
              <CellLabel>Repair estimate ($)</CellLabel>
              <input
                aria-label="Repair estimate in dollars"
                type="number"
                min={0}
                step="any"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="Not set"
                className={`${inputClass} w-full md:text-right`}
              />
            </div>
          </>
        ) : (
          <>
            <div role="cell" className="text-foreground">
              <CellLabel>Category</CellLabel>
              {CATEGORY_LABEL[rule.category] ?? rule.category}
            </div>
            <div role="cell">
              <CellLabel>Severity</CellLabel>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[rule.defaultSeverity] ?? SEVERITY_STYLE.LOW}`}
              >
                {rule.defaultSeverity.toLowerCase()}
              </span>
            </div>
            <div role="cell" className="font-medium tabular-nums text-foreground md:text-right">
              <CellLabel>Condition</CellLabel>−{rule.conditionHit}
            </div>
            <div role="cell" className="font-medium tabular-nums text-foreground md:text-right">
              <CellLabel>Repair estimate</CellLabel>
              <Estimate cents={rule.repairCostCents} />
            </div>
          </>
        )}

        <div role="cell" className="col-span-2 md:col-span-1">
          {customClass ? (
            <span className="text-xs font-medium text-brand">Custom class</span>
          ) : customized ? (
            <>
              <span className="text-xs font-medium text-brand">Customized</span>
              <p className="mt-0.5 text-xs text-muted">
                Default: −{platformDefault.conditionHit},{" "}
                {platformDefault.repairCostCents === null ? "no estimate" : formatCents(platformDefault.repairCostCents)},{" "}
                {platformDefault.defaultSeverity.toLowerCase()}
              </p>
            </>
          ) : (
            <span className="text-xs text-muted">Platform default</span>
          )}
        </div>

        <div role="cell" className="col-span-2 flex gap-2 md:col-span-1 md:justify-end">
          {!canEdit ? null : editing ? (
            <>
              <button
                type="button"
                disabled={busy || !hitValid || costCents === "invalid"}
                onClick={() =>
                  run(() =>
                    send("PUT", {
                      defectClass: rule.defectClass,
                      category,
                      defaultSeverity: severity,
                      conditionHit: hitValue,
                      repairCostCents: costCents === "invalid" ? null : costCents,
                    }),
                  )
                }
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-background"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={startEditing}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-background"
              >
                Edit
              </button>
              {customized || customClass ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const question = customClass
                      ? `Delete the "${humanize(rule.defectClass)}" rule? Findings of this class will no longer get a cost.`
                      : `Reset "${humanize(rule.defectClass)}" to the platform default?`;
                    if (window.confirm(question)) run(() => send("DELETE", undefined, rule.defectClass));
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-background disabled:opacity-50"
                >
                  {customClass ? "Delete" : "Reset"}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

function AddRuleForm({ categories, existing }: { categories: readonly string[]; existing: Set<string> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "Roof");
  const [severity, setSeverity] = useState("MEDIUM");
  const [hit, setHit] = useState("10");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = toClassKey(name);
  const hitValue = Number(hit);
  const hitValid = hit.trim() !== "" && Number.isInteger(hitValue) && hitValue >= 0 && hitValue <= 100;
  const costCents = dollarsToCents(cost);
  const duplicate = existing.has(key);
  const ready = key.length >= 2 && !duplicate && hitValid && costCents !== "invalid";

  async function add() {
    setBusy(true);
    setError(null);
    const message = await send("PUT", {
      defectClass: key,
      category,
      defaultSeverity: severity,
      conditionHit: hitValue,
      repairCostCents: costCents === "invalid" ? null : costCents,
    });
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setName("");
    setCost("");
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) add();
      }}
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <p className="text-sm font-semibold text-foreground">Add a defect class</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
          Defect class
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Signage damage" className={inputClass} />
          <span className="font-mono">{key ? key : " "}</span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c] ?? c}
              </option>
            ))}
          </select>
          <span> </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Severity
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputClass}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
          <span> </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Condition points off
          <input type="number" min={0} max={100} value={hit} onChange={(e) => setHit(e.target.value)} className={`${inputClass} w-24`} />
          <span> </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Repair estimate ($)
          <input
            type="number"
            min={0}
            step="any"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="Not set"
            className={`${inputClass} w-32`}
          />
          <span> </span>
        </label>
        <div className="flex flex-col gap-1">
          <button
            type="submit"
            disabled={busy || !ready}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add rule"}
          </button>
          <span className="text-xs"> </span>
        </div>
      </div>
      {duplicate ? <p className="text-sm text-amber-700">That class already has a rule. Edit it in the table above.</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
