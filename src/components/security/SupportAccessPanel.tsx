"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

export interface SupportAccessEntry {
  id: string;
  adminName: string;
  adminEmail: string;
  reason: string;
  startedAt: string | Date;
  endedAt: string | Date | null;
  active: boolean;
}

/**
 * The customer's side of spec §45: the off-switch, plus the history that
 * makes "log the impersonation" mean something. A log the customer cannot
 * read is not a control.
 */
export function SupportAccessPanel({
  allowSupportAccess,
  history,
  canManage,
}: {
  allowSupportAccess: boolean;
  history: SupportAccessEntry[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(allowSupportAccess);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ allowSupportAccess: boolean; endedSessions: number }>(
        "/api/v1/organizations/support-access",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allowSupportAccess: next }),
        },
      );
      setAllowed(result.allowSupportAccess);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Platform support access"
        subtitle="Whether our support team may open your account to help, and every time they have."
      />
      <CardBody className="space-y-3 text-sm">
        <p>
          <span className="text-muted">Current policy:</span>{" "}
          <span className={allowed ? "font-medium" : "font-medium text-[var(--band-good)]"}>
            {allowed ? "Support may view this account" : "Support access is turned off"}
          </span>
        </p>

        {error ? <p className="text-[var(--band-critical)]">{error}</p> : null}

        {canManage ? (
          <Button variant={allowed ? "secondary" : "primary"} onClick={() => toggle(!allowed)} disabled={busy}>
            {busy ? "Saving..." : allowed ? "Turn off support access" : "Allow support access"}
          </Button>
        ) : null}

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Access history</p>
          {history.length === 0 ? (
            <p className="text-muted">No one from support has opened this account.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {history.map((entry) => (
                <li key={entry.id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{entry.adminName}</span>
                    <span className="text-xs text-muted">
                      {formatDateTime(entry.startedAt)}
                      {entry.endedAt ? ` — ${formatDateTime(entry.endedAt)}` : ""}
                    </span>
                  </div>
                  <p className="text-xs text-muted">{entry.reason}</p>
                  {entry.active ? (
                    <p className="text-xs font-medium text-[var(--band-critical)]">In progress now</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
