"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

export interface EndpointView {
  id: string;
  url: string;
  description: string | null;
  enabled: boolean;
  eventTypes: unknown;
  createdAt: string | Date;
  lastSuccessAt: string | Date | null;
  lastFailureAt: string | Date | null;
  consecutiveFailures: number;
  disabledReason: string | null;
  _count: { deliveries: number };
}

export interface DeliveryView {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: string | Date;
  deliveredAt: string | Date | null;
  nextAttemptAt: string | Date | null;
}

/**
 * Webhook management (spec §66). The design centres on the two questions an
 * integrator actually asks: "is my endpoint receiving?" and "what happened
 * to that one event?" — hence the failure streak on each endpoint and the
 * per-attempt delivery log below it.
 */
export function WebhookManager({
  endpoints,
  deliveries,
  availableEventTypes,
}: {
  endpoints: EndpointView[];
  deliveries: DeliveryView[];
  availableEventTypes: string[];
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<{ url: string; secret: string } | null>(null);

  async function run<T>(action: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(action);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}

      {newSecret ? (
        <Card>
          <CardHeader title="Save this signing secret now" />
          <CardBody className="space-y-2 text-sm">
            <p className="text-muted">
              It is stored encrypted and cannot be shown again. Your receiver uses it to verify that a delivery
              really came from us.
            </p>
            <p className="break-all rounded-lg border border-[var(--band-needs-attention)] bg-background px-3 py-2 font-mono text-sm">
              {newSecret.secret}
            </p>
            <p className="text-xs text-muted">for {newSecret.url}</p>
            <Button variant="secondary" onClick={() => setNewSecret(null)}>
              I&apos;ve saved it
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Add an endpoint"
          subtitle="We POST a signed JSON payload to this URL whenever a subscribed event happens."
        />
        <CardBody className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-muted">Endpoint URL (https)</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-cmms.example.com/hooks/npi"
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="CMMS work-order sync"
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted">
              Events {selected.length === 0 ? "(none selected = send everything)" : `(${selected.length} selected)`}
            </label>
            <div className="mt-1 flex flex-wrap gap-2">
              {availableEventTypes.map((type) => {
                const on = selected.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSelected(on ? selected.filter((t) => t !== type) : [...selected, type])}
                    className={`rounded-full border px-3 py-1 font-mono text-xs ${
                      on ? "border-brand bg-brand text-brand-foreground" : "border-border text-muted hover:border-brand"
                    }`}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          </div>

          <Button
            disabled={busy !== null || url.trim().length === 0}
            onClick={async () => {
              const created = await run("create", () =>
                apiFetch<{ id: string; secret: string }>("/api/v1/webhooks/endpoints", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ url, description: description || undefined, eventTypes: selected }),
                }),
              );
              if (created) {
                setNewSecret({ url, secret: created.secret });
                setUrl("");
                setDescription("");
                setSelected([]);
                router.refresh();
              }
            }}
          >
            {busy === "create" ? "Adding..." : "Add endpoint"}
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Endpoints" subtitle={`${endpoints.length} registered`} />
        <CardBody className="p-0 text-sm">
          {endpoints.length === 0 ? (
            <p className="p-4 text-muted">No endpoints yet.</p>
          ) : (
            <ul>
              {endpoints.map((e) => {
                const types = Array.isArray(e.eventTypes) ? (e.eventTypes as string[]) : [];
                return (
                  <li key={e.id} className="border-b border-border px-4 py-3 last:border-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs text-foreground">{e.url}</p>
                        <p className="text-xs text-muted">
                          {e.description ? `${e.description} · ` : ""}
                          {types.length === 0 ? "all events" : types.join(", ")} · {e._count.deliveries} deliveries
                        </p>
                        <p className="text-xs text-muted">
                          {e.lastSuccessAt ? `Last success ${formatDateTime(e.lastSuccessAt)}` : "No successful delivery yet"}
                          {e.consecutiveFailures > 0 ? ` · ${e.consecutiveFailures} consecutive failures` : ""}
                        </p>
                        {e.disabledReason ? (
                          <p className="text-xs font-medium text-[var(--band-critical)]">{e.disabledReason}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${e.enabled ? "text-[var(--band-good)]" : "text-muted"}`}>
                          {e.enabled ? "Enabled" : "Disabled"}
                        </span>
                        <Button
                          variant="ghost"
                          disabled={busy === `toggle-${e.id}`}
                          onClick={() =>
                            run(`toggle-${e.id}`, () =>
                              apiFetch(`/api/v1/webhooks/endpoints/${e.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ enabled: !e.enabled }),
                              }),
                            ).then(() => router.refresh())
                          }
                        >
                          {e.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy === `rotate-${e.id}`}
                          onClick={async () => {
                            const result = await run(`rotate-${e.id}`, () =>
                              apiFetch<{ secret: string }>(`/api/v1/webhooks/endpoints/${e.id}/rotate-secret`, { method: "POST" }),
                            );
                            if (result) setNewSecret({ url: e.url, secret: result.secret });
                          }}
                        >
                          Rotate secret
                        </Button>
                        <Button
                          variant="danger"
                          disabled={busy === `delete-${e.id}`}
                          onClick={() =>
                            run(`delete-${e.id}`, () =>
                              apiFetch(`/api/v1/webhooks/endpoints/${e.id}`, { method: "DELETE" }),
                            ).then(() => router.refresh())
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent deliveries" subtitle="Every attempt, so “did you send it?” has an answer." />
        <CardBody className="p-0 text-sm">
          {deliveries.length === 0 ? (
            <p className="p-4 text-muted">Nothing delivered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-background text-left text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Event</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Attempts</th>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Detail</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-1.5 font-mono text-foreground">{d.eventType}</td>
                      <td className={`px-3 py-1.5 font-medium ${statusTone(d.status)}`}>{d.status}</td>
                      <td className="px-3 py-1.5 tabular-nums text-muted">{d.attempts}</td>
                      <td className="px-3 py-1.5 text-muted">{formatDateTime(d.deliveredAt ?? d.createdAt)}</td>
                      <td className="px-3 py-1.5 text-muted">
                        {d.responseStatus ? `HTTP ${d.responseStatus}` : ""}
                        {d.error ? ` ${d.error}` : ""}
                        {d.nextAttemptAt && d.status === "FAILED" ? ` · retrying ${formatDateTime(d.nextAttemptAt)}` : ""}
                      </td>
                      <td className="px-4 py-1.5">
                        {d.status === "FAILED" || d.status === "EXHAUSTED" ? (
                          <Button
                            variant="ghost"
                            disabled={busy === `replay-${d.id}`}
                            onClick={() =>
                              run(`replay-${d.id}`, () =>
                                apiFetch(`/api/v1/webhooks/deliveries/${d.id}/replay`, { method: "POST" }),
                              ).then(() => router.refresh())
                            }
                          >
                            Replay
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function statusTone(status: string): string {
  if (status === "SUCCEEDED") return "text-[var(--band-good)]";
  if (status === "EXHAUSTED") return "text-[var(--band-critical)]";
  if (status === "FAILED") return "text-[var(--band-needs-attention)]";
  return "text-muted";
}
