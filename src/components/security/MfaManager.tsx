"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import type { MfaStatus } from "@/lib/mfa-service";

/**
 * Enrollment/management UI for the user's own second factor (spec §43).
 *
 * The QR code is rendered as a link-out plus the otpauth URI and the raw
 * secret rather than an inline QR image: generating one would mean adding a
 * QR dependency, and every authenticator app accepts a pasted setup key.
 * The URI is shown so a desktop user can click it into their app.
 */
export function MfaManager({ status: initialStatus }: { status: MfaStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run<T>(action: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function refreshStatus() {
    const next = await apiFetch<MfaStatus>("/api/v1/auth/mfa");
    setStatus(next);
  }

  if (status.state === "UNAVAILABLE") {
    return (
      <Card>
        <CardHeader title="Two-Factor Authentication" />
        <CardBody>
          <EmptyState
            title="Multi-factor authentication is unavailable in this environment"
            description="No key is configured to encrypt TOTP secrets. Set MFA_ENCRYPTION_KEY (or NEXTAUTH_SECRET) and this becomes available — secrets are never stored unencrypted, so enrollment refuses rather than degrading."
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Two-Factor Authentication"
        subtitle="A time-based code from an authenticator app, required in addition to your password."
      />
      <CardBody className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <span className="text-muted">Status:</span>{" "}
            <span className={status.state === "ENABLED" ? "font-medium text-[var(--band-good)]" : "font-medium text-muted"}>
              {status.state === "ENABLED" ? "Enabled" : status.state === "PENDING" ? "Setup started" : "Not enabled"}
            </span>
          </span>
          {status.enabledAt ? <span><span className="text-muted">Enabled:</span> {formatDate(status.enabledAt)}</span> : null}
          {status.state === "ENABLED" ? (
            <span>
              <span className="text-muted">Unused recovery codes:</span>{" "}
              <span className={status.unusedRecoveryCodes <= 2 ? "font-medium text-[var(--band-needs-attention)]" : ""}>
                {status.unusedRecoveryCodes}
              </span>
            </span>
          ) : null}
        </div>

        {status.requiredByPolicy ? (
          <p className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted">
            Your organization requires two-factor authentication. It cannot be turned off here.
          </p>
        ) : null}

        {error ? <p className="text-[var(--band-critical)]">{error}</p> : null}
        {notice ? <p className="text-[var(--band-good)]">{notice}</p> : null}

        {recoveryCodes ? (
          <div className="space-y-2 rounded-lg border border-[var(--band-needs-attention)] bg-background p-4">
            <p className="font-medium text-foreground">Save these recovery codes now</p>
            <p className="text-xs text-muted">
              Each one signs you in once if you lose your authenticator. They are stored hashed — this is the only time
              they can be shown.
            </p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
              {recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard?.writeText(recoveryCodes.join("\n"));
                setNotice("Recovery codes copied to the clipboard.");
              }}
            >
              Copy all
            </Button>
          </div>
        ) : null}

        {status.state !== "ENABLED" && !enrollment ? (
          <Button
            onClick={async () => {
              const result = await run("enroll", () =>
                apiFetch<{ secret: string; otpauthUri: string }>("/api/v1/auth/mfa/enroll", { method: "POST" }),
              );
              if (result) setEnrollment(result);
            }}
            disabled={busy === "enroll"}
          >
            {busy === "enroll" ? "Starting..." : status.state === "PENDING" ? "Restart setup" : "Set up two-factor authentication"}
          </Button>
        ) : null}

        {status.state !== "ENABLED" && enrollment ? (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <p className="font-medium text-foreground">1. Add this to your authenticator app</p>
            <p className="text-xs text-muted">Setup key (type this in, or open the link on a device with the app installed):</p>
            <p className="break-all rounded bg-background px-3 py-2 font-mono text-sm">{enrollment.secret}</p>
            <a href={enrollment.otpauthUri} className="inline-block break-all text-xs text-brand underline">
              {enrollment.otpauthUri}
            </a>

            <p className="pt-2 font-medium text-foreground">2. Enter the 6-digit code it shows</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="w-32 rounded-lg border border-border px-3 py-2 font-mono text-sm outline-none focus:border-brand"
              />
              <Button
                onClick={async () => {
                  const result = await run("activate", () =>
                    apiFetch<{ recoveryCodes: string[] }>("/api/v1/auth/mfa/activate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ code }),
                    }),
                  );
                  if (result) {
                    setRecoveryCodes(result.recoveryCodes);
                    setEnrollment(null);
                    setCode("");
                    await refreshStatus();
                  }
                }}
                disabled={busy === "activate" || code.trim().length === 0}
              >
                {busy === "activate" ? "Verifying..." : "Turn on"}
              </Button>
            </div>
          </div>
        ) : null}

        {status.state === "ENABLED" ? (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <p className="text-xs text-muted">
              Enter a current code (or an unused recovery code) to authorize a change.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="text"
                autoComplete="one-time-code"
                placeholder="000000"
                className="w-40 rounded-lg border border-border px-3 py-2 font-mono text-sm outline-none focus:border-brand"
              />
              <Button
                variant="secondary"
                onClick={async () => {
                  const result = await run("regen", () =>
                    apiFetch<{ recoveryCodes: string[] }>("/api/v1/auth/mfa/recovery-codes", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ code }),
                    }),
                  );
                  if (result) {
                    setRecoveryCodes(result.recoveryCodes);
                    setCode("");
                    await refreshStatus();
                  }
                }}
                disabled={busy === "regen" || code.trim().length === 0}
              >
                {busy === "regen" ? "Working..." : "Regenerate recovery codes"}
              </Button>
              {!status.requiredByPolicy ? (
                <Button
                  variant="danger"
                  onClick={async () => {
                    const result = await run("disable", () =>
                      apiFetch<{ disabled: boolean }>("/api/v1/auth/mfa/disable", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ code }),
                      }),
                    );
                    if (result) {
                      setRecoveryCodes(null);
                      setCode("");
                      setNotice("Two-factor authentication is off.");
                      await refreshStatus();
                    }
                  }}
                  disabled={busy === "disable" || code.trim().length === 0}
                >
                  {busy === "disable" ? "Working..." : "Turn off"}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
