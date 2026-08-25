"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface Target {
  id: string;
  name: string;
  allowSupportAccess: boolean;
}

/**
 * Starting a support session (spec §45). The reason field is not optional
 * and not free of consequence — it is stored, written to the customer's own
 * audit log, and shown in the banner for the whole session.
 */
export function ImpersonationLauncher({ organizations }: { organizations: Target[] }) {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = organizations.find((o) => o.id === organizationId);
  const tooShort = reason.trim().length < 10;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/v1/admin/impersonation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, reason }),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Support Access"
        subtitle="View a customer's account read-only. Logged to their audit trail, shown to them, and time-limited."
      />
      <CardBody className="space-y-3 text-sm">
        <label className="block text-xs font-medium text-muted">Organization</label>
        <select
          value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value)}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
        >
          {organizations.map((o) => (
            <option key={o.id} value={o.id} disabled={!o.allowSupportAccess}>
              {o.name}
              {o.allowSupportAccess ? "" : " — support access disabled by customer"}
            </option>
          ))}
        </select>

        <label className="block text-xs font-medium text-muted">Reason (shown to the customer)</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ticket #1234 — investigating missing assessment data"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
        />

        {target && !target.allowSupportAccess ? (
          <p className="text-xs text-[var(--band-needs-attention)]">
            This customer has turned support access off. They must re-enable it before you can view their account.
          </p>
        ) : null}
        {error ? <p className="text-[var(--band-critical)]">{error}</p> : null}

        <Button onClick={start} disabled={busy || tooShort || !target?.allowSupportAccess}>
          {busy ? "Starting..." : "Start support session"}
        </Button>
        <p className="text-xs text-muted">
          The session is read-only and ends automatically after 60 minutes.
        </p>
      </CardBody>
    </Card>
  );
}
