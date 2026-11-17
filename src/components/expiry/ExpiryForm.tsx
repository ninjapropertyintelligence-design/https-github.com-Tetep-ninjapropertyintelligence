"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

const INPUT = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand";

export interface ExpiryFormValues {
  kind: string;
  label: string;
  expiresAt: string;
  lastInspectedAt: string;
  servicedBy: string;
  notifyContractor: boolean;
}

export const EMPTY_EXPIRY: ExpiryFormValues = {
  kind: "",
  label: "",
  expiresAt: "",
  lastInspectedAt: "",
  servicedBy: "",
  notifyContractor: false,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted">
      {label}
      <div className="mt-1 text-sm font-normal text-foreground">{children}</div>
    </label>
  );
}

/** Adds something that expires, by hand. Also the fallback when a tag could not be read from a photo. */
export function ExpiryForm({
  propertyId,
  assetId,
  kinds,
  initial = EMPTY_EXPIRY,
  evidenceId,
  hasContractor = false,
  onDone,
}: {
  propertyId: string;
  assetId?: string;
  kinds: readonly string[];
  initial?: ExpiryFormValues;
  /** The photo of the tag, kept as proof. */
  evidenceId?: string;
  /** Whether the equipment has a contractor to copy. */
  hasContractor?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState<ExpiryFormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ExpiryFormValues>(key: K, value: ExpiryFormValues[K]) => setV({ ...v, [key]: value });

  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiRequest("/api/v1/expiries", {
      method: "POST",
      body: JSON.stringify({ ...v, propertyId, assetId: assetId ?? null, evidenceId: evidenceId ?? null }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setV(EMPTY_EXPIRY);
    router.refresh();
    onDone?.();
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="What expires">
          <input required list="expiry-kinds" value={v.kind} onChange={(e) => set("kind", e.target.value)} className={INPUT} placeholder="Fire extinguisher inspection" />
          <datalist id="expiry-kinds">
            {kinds.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </Field>
        <Field label="Which one (optional)">
          <input value={v.label} onChange={(e) => set("label", e.target.value)} className={INPUT} placeholder="By the back door" />
        </Field>
        <Field label="Expires on">
          <input required type="date" value={v.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} className={INPUT} />
        </Field>
        <Field label="Last inspected (optional)">
          <input type="date" value={v.lastInspectedAt} onChange={(e) => set("lastInspectedAt", e.target.value)} className={INPUT} />
        </Field>
        <Field label="Serviced by (optional)">
          <input value={v.servicedBy} onChange={(e) => set("servicedBy", e.target.value)} className={INPUT} />
        </Field>
      </div>
      {hasContractor ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.notifyContractor} onChange={(e) => set("notifyContractor", e.target.checked)} />
          Also email this equipment&apos;s contractor when it&apos;s coming up
        </label>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !v.kind.trim() || !v.expiresAt}>
          {busy ? "Saving…" : "Start counting down"}
        </Button>
        {error ? <span className="text-xs text-[var(--band-critical)]">{error}</span> : null}
      </div>
    </form>
  );
}
