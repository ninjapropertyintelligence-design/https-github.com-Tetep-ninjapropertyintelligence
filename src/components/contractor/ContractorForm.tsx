"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

const INPUT = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand";

export type ContractorFormValues = {
  name: string;
  trade: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  emergencyPhone: string;
  notes: string;
  servesAllProperties: boolean;
  propertyIds: string[];
};

export const EMPTY_CONTRACTOR: ContractorFormValues = {
  name: "",
  trade: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  emergencyPhone: "",
  notes: "",
  servesAllProperties: true,
  propertyIds: [],
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted">
      {label}
      <div className="mt-1 text-sm font-normal text-foreground">{children}</div>
    </label>
  );
}

/** Adds a contractor, or edits one: who they are, how to reach them, which stores they serve. */
export function ContractorForm({
  contractorId,
  initial = EMPTY_CONTRACTOR,
  trades,
  properties,
  onDone,
}: {
  contractorId?: string;
  initial?: ContractorFormValues;
  trades: readonly string[];
  properties: Array<{ id: string; name: string }>;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState<ContractorFormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ContractorFormValues>(key: K, value: ContractorFormValues[K]) => setV({ ...v, [key]: value });

  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiRequest(contractorId ? `/api/v1/vendors/${contractorId}` : "/api/v1/vendors", {
      method: contractorId ? "PATCH" : "POST",
      body: JSON.stringify(v),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (!contractorId) setV(EMPTY_CONTRACTOR);
    router.refresh();
    onDone?.();
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Company name">
          <input required value={v.name} onChange={(e) => set("name", e.target.value)} className={INPUT} placeholder="Midwest Refrigeration" />
        </Field>
        <Field label="Trade">
          <input list="contractor-trades" value={v.trade} onChange={(e) => set("trade", e.target.value)} className={INPUT} placeholder="Refrigeration" />
          <datalist id="contractor-trades">
            {trades.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Who to ask for">
          <input value={v.contactName} onChange={(e) => set("contactName", e.target.value)} className={INPUT} />
        </Field>
        <Field label="Email">
          <input type="email" value={v.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} className={INPUT} />
        </Field>
        <Field label="Phone">
          <input type="tel" value={v.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} className={INPUT} />
        </Field>
        <Field label="After-hours / emergency phone">
          <input type="tel" value={v.emergencyPhone} onChange={(e) => set("emergencyPhone", e.target.value)} className={INPUT} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={INPUT} placeholder="Account number, response time, what they cover…" />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted">Stores served</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.servesAllProperties} onChange={(e) => set("servesAllProperties", e.target.checked)} />
          Every store
        </label>
        {!v.servesAllProperties ? (
          <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-border p-3 md:grid-cols-2">
            {properties.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={v.propertyIds.includes(p.id)}
                  onChange={(e) => set("propertyIds", e.target.checked ? [...v.propertyIds, p.id] : v.propertyIds.filter((id) => id !== p.id))}
                />
                {p.name}
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !v.name.trim()}>
          {busy ? "Saving…" : contractorId ? "Save changes" : "Add contractor"}
        </Button>
        {error ? <span className="text-xs text-[var(--band-critical)]">{error}</span> : null}
      </div>
    </form>
  );
}
