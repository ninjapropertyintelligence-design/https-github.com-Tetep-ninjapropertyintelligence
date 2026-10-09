"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

interface Rule {
  id: string;
  defectClass: string;
  label: string;
  assetCategory: string | null;
  defaultSeverity: string;
  conditionPenalty: number;
  defaultRepairCostCents: number | null;
}

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand";
const dollars = (cents: number | null) =>
  cents === null ? "—" : `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

const EMPTY = { defectClass: "", label: "", assetCategory: "", defaultSeverity: "MEDIUM", conditionPenalty: "5", cost: "" };

/** The rule list, with one form for adding a rule or editing the one picked. */
export function DefectRulesEditor({ rules }: { rules: Rule[] }) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  function edit(rule: Rule) {
    setEditing(rule.id);
    setError(null);
    setForm({
      defectClass: rule.defectClass,
      label: rule.label,
      assetCategory: rule.assetCategory ?? "",
      defaultSeverity: rule.defaultSeverity,
      conditionPenalty: String(rule.conditionPenalty),
      cost: rule.defaultRepairCostCents !== null ? String(rule.defaultRepairCostCents / 100) : "",
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const cost = form.cost.trim() === "" ? null : Number(form.cost);
    const penalty = Number(form.conditionPenalty);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
      setError("Enter the repair cost as a number of dollars, or leave it blank.");
      return;
    }
    if (!Number.isInteger(penalty) || penalty < 0 || penalty > 100) {
      setError("The condition hit is a whole number of points from 0 to 100.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiRequest("/api/v1/defect-rules", {
      method: "POST",
      body: JSON.stringify({
        defectClass: form.defectClass,
        label: form.label,
        assetCategory: form.assetCategory || null,
        defaultSeverity: form.defaultSeverity,
        conditionPenalty: penalty,
        defaultRepairCostCents: cost === null ? null : Math.round(cost * 100),
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setForm(EMPTY);
    setEditing(null);
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/v1/defect-rules/${id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmDelete(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <Card>
        <CardHeader title="Rules" subtitle={`${rules.length} defect classes`} />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-5 py-2 font-medium">Defect</th>
                  <th className="px-3 py-2 font-medium">Severity</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Condition</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-foreground">{r.label}</p>
                      <p className="font-mono text-xs text-muted">
                        {r.defectClass}
                        {r.assetCategory ? ` · ${r.assetCategory}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">{sentence(r.defaultSeverity)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{dollars(r.defaultRepairCostCents)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">−{r.conditionPenalty}</td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right">
                      {confirmDelete === r.id ? (
                        <span className="inline-flex gap-1">
                          <Button type="button" variant="danger" disabled={busy} onClick={() => remove(r.id)}>
                            Delete
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(null)}>
                            Keep
                          </Button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1">
                          <Button type="button" variant="secondary" onClick={() => edit(r)}>
                            Edit
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(r.id)}>
                            Delete
                          </Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {rules.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-muted">
                      No rules yet. Add one for each defect class your vision model reports.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={editing ? "Edit rule" : "Add a rule"} />
        <CardBody>
          <form onSubmit={save} className="space-y-3">
            <label className="block text-xs font-medium text-muted">
              Defect class (as the model names it)
              <input
                required
                value={form.defectClass}
                onChange={(e) => set({ defectClass: e.target.value })}
                disabled={!!editing}
                placeholder="concrete_spalling"
                className={`${inputClass} font-mono`}
              />
            </label>
            <label className="block text-xs font-medium text-muted">
              Name people read
              <input required value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="Concrete spalling" className={inputClass} />
            </label>
            <label className="block text-xs font-medium text-muted">
              Usually affects (optional)
              <input value={form.assetCategory} onChange={(e) => set({ assetCategory: e.target.value })} placeholder="Facade" className={inputClass} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-muted">
                Severity
                <select value={form.defaultSeverity} onChange={(e) => set({ defaultSeverity: e.target.value })} className={inputClass}>
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {sentence(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-muted">
                Condition hit
                <input inputMode="numeric" value={form.conditionPenalty} onChange={(e) => set({ conditionPenalty: e.target.value })} className={inputClass} />
              </label>
            </div>
            <label className="block text-xs font-medium text-muted">
              Typical repair cost ($, optional)
              <input inputMode="decimal" value={form.cost} onChange={(e) => set({ cost: e.target.value })} className={inputClass} />
            </label>
            {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : editing ? "Save rule" : "Add rule"}
              </Button>
              {editing ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setEditing(null);
                    setForm(EMPTY);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
