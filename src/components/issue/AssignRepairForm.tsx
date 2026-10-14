"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

interface Option {
  id: string;
  label: string;
}

/**
 * Who is sent to fix this: a vendor company or a staff member. Whoever is
 * chosen is notified and can then start the repair, add photos and mark it
 * done. Choosing a vendor gives that company access to this building until
 * the repair is accepted.
 */
export function AssignRepairForm({
  issueId,
  version,
  vendors,
  staff,
  currentVendorId,
  currentAssigneeId,
}: {
  issueId: string;
  version: number;
  vendors: Option[];
  staff: Option[];
  currentVendorId: string | null;
  currentAssigneeId: string | null;
}) {
  const router = useRouter();
  const initial = currentVendorId ? `vendor:${currentVendorId}` : currentAssigneeId ? `user:${currentAssigneeId}` : "";
  const [choice, setChoice] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const [kind, id] = choice.split(":");
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/v1/issues/${issueId}`, {
      method: "PATCH",
      body: JSON.stringify({
        version,
        vendorId: kind === "vendor" ? id : null,
        assigneeId: kind === "user" ? id : null,
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-xs font-medium text-muted">
        Send to repair
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">Nobody yet</option>
          {vendors.length > 0 ? (
            <optgroup label="Vendor companies">
              {vendors.map((v) => (
                <option key={v.id} value={`vendor:${v.id}`}>
                  {v.label}
                </option>
              ))}
            </optgroup>
          ) : null}
          {staff.length > 0 ? (
            <optgroup label="Staff">
              {staff.map((s) => (
                <option key={s.id} value={`user:${s.id}`}>
                  {s.label}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>
      <Button type="submit" variant="secondary" disabled={busy || choice === initial}>
        {busy ? "Saving…" : "Assign"}
      </Button>
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
    </form>
  );
}
