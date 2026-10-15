"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";

export interface ConnectionView {
  provider: "DRONEDEPLOY" | "MATTERPORT";
  connected: boolean;
  status: string | null;
  accountLabel: string | null;
  errorMessage: string | null;
  connectedAt: string | null;
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand";

const INFO = {
  DRONEDEPLOY: {
    name: "DroneDeploy",
    what: "Pick a flight you processed in DroneDeploy on a job site. Its map is copied in for you — no download and re-upload.",
    how: "In DroneDeploy, open Settings → API keys and create a key (API access needs a DroneDeploy plan that includes it).",
  },
  MATTERPORT: {
    name: "Matterport",
    what: "Pick one of your Matterport scans on a job site instead of pasting its link.",
    how: "In Matterport, open Settings → Developer Tools → API Token Management and generate a token. Copy both the token ID and the secret.",
  },
} as const;

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await res.json().catch(() => null)) as { data?: { items?: ConnectionView[] }; error?: unknown } | null;
  if (!res.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`);
  return payload?.data?.items ?? [];
}

/**
 * The vendor connecting its own DroneDeploy and Matterport accounts. Keys are
 * sent once, checked with the provider by the server, and never shown again.
 */
export function VendorConnectionsPanel({ initial }: { initial: ConnectionView[] }) {
  const [connections, setConnections] = useState(initial);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {connections.map((c) => (
        <ConnectionCard key={c.provider} connection={c} onChange={setConnections} />
      ))}
    </div>
  );
}

function ConnectionCard({
  connection,
  onChange,
}: {
  connection: ConnectionView;
  onChange: (items: ConnectionView[]) => void;
}) {
  const info = INFO[connection.provider];
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [tokenSecret, setTokenSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const items = await call(
        "POST",
        "/api/v1/vendor/connections",
        connection.provider === "DRONEDEPLOY"
          ? { provider: "DRONEDEPLOY", apiKey }
          : { provider: "MATTERPORT", tokenId, tokenSecret },
      );
      onChange(items);
      setApiKey("");
      setTokenId("");
      setTokenSecret("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(`Disconnect ${info.name}? Work already brought in stays where it is.`)) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await call("DELETE", `/api/v1/vendor/connections?provider=${connection.provider}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{info.name}</h3>
          <p className="mt-1 text-sm text-muted">{info.what}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${
            !connection.connected
              ? "border-border text-muted"
              : connection.status === "ERROR"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {!connection.connected ? "Not connected" : connection.status === "ERROR" ? "Needs attention" : "Connected"}
        </span>
      </div>

      {connection.connected ? (
        <p className="text-xs text-muted">
          {connection.accountLabel ? `Account: ${connection.accountLabel}. ` : ""}
          {connection.connectedAt ? `Connected ${new Date(connection.connectedAt).toLocaleDateString()}.` : ""}
          {connection.errorMessage ? <span className="block text-[var(--band-critical)]">{connection.errorMessage}</span> : null}
        </p>
      ) : null}

      {open ? (
        <form onSubmit={connect} className="space-y-2">
          <p className="text-xs text-muted">{info.how}</p>
          {connection.provider === "DRONEDEPLOY" ? (
            <label className="block text-xs font-medium text-muted">
              DroneDeploy API key
              <input
                type="password"
                autoComplete="off"
                required
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </label>
          ) : (
            <>
              <label className="block text-xs font-medium text-muted">
                Matterport token ID
                <input autoComplete="off" required value={tokenId} onChange={(e) => setTokenId(e.target.value)} className={`mt-1 ${inputClass}`} />
              </label>
              <label className="block text-xs font-medium text-muted">
                Matterport token secret
                <input
                  type="password"
                  autoComplete="off"
                  required
                  value={tokenSecret}
                  onChange={(e) => setTokenSecret(e.target.value)}
                  className={`mt-1 ${inputClass}`}
                />
              </label>
            </>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Checking…" : `Connect ${info.name}`}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button type="button" variant={connection.connected ? "secondary" : "primary"} onClick={() => setOpen(true)} disabled={busy}>
            {connection.connected ? "Replace key" : `Connect ${info.name}`}
          </Button>
          {connection.connected ? (
            <Button type="button" variant="ghost" onClick={disconnect} disabled={busy}>
              Disconnect
            </Button>
          ) : null}
        </div>
      )}
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
    </div>
  );
}
