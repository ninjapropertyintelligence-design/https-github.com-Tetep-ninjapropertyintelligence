"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiFetch, ApiClientError } from "@/lib/api-client";

/**
 * Org-wide "everyone must use MFA" policy (spec §43). Turning it on tells
 * the admin exactly how many members it will lock out first, and refuses to
 * let them lock *themselves* out — the single most common way this feature
 * turns into a support ticket.
 */
export function OrgMfaPolicy({
  requireMfa,
  unenrolledMembers,
  selfEnrolled,
}: {
  requireMfa: boolean;
  unenrolledMembers: number;
  selfEnrolled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(requireMfa);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blockedBySelf = !enabled && !selfEnrolled;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/v1/organizations/mfa-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireMfa: next }),
      });
      setEnabled(next);
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
        title="Require two-factor authentication"
        subtitle="Applies to every member of this organization, enforced on the API as well as the UI."
      />
      <CardBody className="space-y-3 text-sm">
        <p>
          <span className="text-muted">Current policy:</span>{" "}
          <span className={enabled ? "font-medium text-[var(--band-good)]" : "font-medium text-muted"}>
            {enabled ? "Required" : "Optional"}
          </span>
        </p>

        {!enabled && unenrolledMembers > 0 ? (
          <p className="rounded-lg border border-[var(--band-needs-attention)] bg-background px-3 py-2 text-xs">
            {unenrolledMembers} member{unenrolledMembers === 1 ? "" : "s"} have not enrolled yet. Turning this on stops
            them using the app until they do.
          </p>
        ) : null}

        {blockedBySelf ? (
          <p className="text-xs text-muted">Enrol your own account above before requiring it of everyone else.</p>
        ) : null}

        {error ? <p className="text-[var(--band-critical)]">{error}</p> : null}

        <Button
          variant={enabled ? "secondary" : "primary"}
          onClick={() => toggle(!enabled)}
          disabled={busy || blockedBySelf}
        >
          {busy ? "Saving..." : enabled ? "Make optional" : "Require for everyone"}
        </Button>
      </CardBody>
    </Card>
  );
}
