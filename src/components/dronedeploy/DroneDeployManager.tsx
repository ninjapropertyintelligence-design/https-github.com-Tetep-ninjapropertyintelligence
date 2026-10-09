"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate, formatRelativeTime } from "@/lib/format";

/** Serialised across the server/client boundary: dates arrive as strings. */
export interface DroneDeployStatusView {
  entitled: boolean;
  layers: string[];
  connection: {
    status: string;
    errorMessage: string | null;
    importSince: string;
    matchRadiusMeters: number;
    lastPolledAt: string | null;
    connectedAt: string;
  } | null;
  imports: Array<{
    id: string;
    planName: string | null;
    planCreatedAt: string | null;
    status: "UNMATCHED" | "IMPORTING" | "IMPORTED" | "FAILED" | "IGNORED";
    matchedBy: string | null;
    matchDistanceMeters: number | null;
    errorMessage: string | null;
    property: { id: string; name: string } | null;
    exports: Array<{ layer: string; status: string; errorMessage: string | null }>;
  }>;
}

const STATUS_LABEL: Record<DroneDeployStatusView["imports"][number]["status"], { text: string; className: string }> = {
  UNMATCHED: { text: "Needs a property", className: "bg-amber-50 text-amber-700" },
  IMPORTING: { text: "Importing", className: "bg-blue-50 text-blue-700" },
  IMPORTED: { text: "Imported", className: "bg-green-50 text-green-700" },
  FAILED: { text: "Failed", className: "bg-red-50 text-red-700" },
  IGNORED: { text: "Ignored", className: "bg-zinc-100 text-zinc-500" },
};

export function DroneDeployManager({
  status,
  properties,
  canManageImports,
}: {
  status: DroneDeployStatusView;
  properties: Array<{ id: string; label: string }>;
  canManageImports: boolean;
}) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  async function run(action: string, fn: () => Promise<unknown>) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const connection = status.connection;
  const waiting = status.imports.filter((i) => i.status === "UNMATCHED");

  if (!status.entitled && !connection) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            title="Drone capture is not enabled for your organization"
            description="DroneDeploy auto-import files maps as drone captures, so it needs drone capture on your plan. Contact your administrator to add it."
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--band-good)]">{notice}</p> : null}

      <Card>
        <CardHeader
          title={connection ? "Connected" : "Connect DroneDeploy"}
          subtitle={
            connection
              ? `Pulling ${status.layers.join(", ").toLowerCase()} for maps created after ${formatDate(connection.importSince)}`
              : "Paste an API key from your DroneDeploy account. API access needs a DroneDeploy Enterprise or Developer Partner plan."
          }
        />
        <CardBody className="space-y-3 text-sm">
          {connection ? (
            <>
              <p>
                <span className="text-muted">Status:</span>{" "}
                <span
                  className={`font-medium ${connection.status === "CONNECTED" ? "text-[var(--band-good)]" : "text-[var(--band-critical)]"}`}
                >
                  {connection.status === "CONNECTED" ? "Connected" : "Error"}
                </span>
                {connection.errorMessage ? <span className="text-muted"> — {connection.errorMessage}</span> : null}
              </p>
              <p>
                <span className="text-muted">Last checked:</span>{" "}
                {connection.lastPolledAt ? formatRelativeTime(connection.lastPolledAt) : "not yet"}
              </p>
              <p>
                <span className="text-muted">Auto-match radius:</span> {connection.matchRadiusMeters} m — a map is filed to
                a property automatically only when exactly one property lies within this distance of it.
              </p>
              <div className="flex flex-wrap gap-2">
                {canManageImports ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      run("sync", async () => {
                        const r = await apiFetch<{ newMaps: number; exportsImported: number; error?: string }>(
                          "/api/v1/integrations/dronedeploy/sync",
                          { method: "POST" },
                        );
                        setNotice(
                          r.error
                            ? `Checked, with an error: ${r.error}`
                            : `Checked DroneDeploy: ${r.newMaps} new ${r.newMaps === 1 ? "map" : "maps"}, ${r.exportsImported} ${r.exportsImported === 1 ? "file" : "files"} copied.`,
                        );
                      })
                    }
                  >
                    {busy === "sync" ? "Checking…" : "Check now"}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => {
                    if (!confirm("Disconnect DroneDeploy? Maps already imported stay on their properties.")) return;
                    run("disconnect", () => apiFetch("/api/v1/integrations/dronedeploy", { method: "DELETE" }));
                  }}
                >
                  Disconnect
                </Button>
              </div>
            </>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={connection ? "Replace API key" : "DroneDeploy API key"}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand sm:max-w-md"
            />
            <Button
              disabled={busy !== null || apiKey.trim().length === 0}
              onClick={() =>
                run("connect", async () => {
                  await apiFetch("/api/v1/integrations/dronedeploy", json({ apiKey }));
                  setApiKey("");
                  setNotice("DroneDeploy accepted the key. New maps will be imported automatically.");
                })
              }
            >
              {busy === "connect" ? "Checking key…" : connection ? "Replace key" : "Connect"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {waiting.length > 0 ? (
        <Card>
          <CardHeader
            title={`${waiting.length} ${waiting.length === 1 ? "map needs" : "maps need"} a property`}
            subtitle="These could not be matched by location. Choose where each one belongs, or ignore it."
          />
          <CardBody className="p-0">
            <ul>
              {waiting.map((imp) => (
                <li key={imp.id} className="flex flex-col gap-2 border-b border-border px-5 py-3 text-sm last:border-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{imp.planName ?? "Untitled map"}</p>
                    <p className="text-xs text-muted">
                      {imp.planCreatedAt ? formatDate(imp.planCreatedAt) : "Date unknown"}
                      {imp.errorMessage ? ` · ${imp.errorMessage}` : ""}
                    </p>
                  </div>
                  {canManageImports ? (
                    <div className="flex shrink-0 gap-2">
                      <select
                        value={choice[imp.id] ?? ""}
                        onChange={(e) => setChoice({ ...choice, [imp.id]: e.target.value })}
                        className="w-56 rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
                        aria-label={`Property for ${imp.planName ?? "map"}`}
                      >
                        <option value="">Choose property…</option>
                        {properties.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        disabled={busy !== null || !choice[imp.id]}
                        onClick={() =>
                          run(`assign-${imp.id}`, () =>
                            apiFetch(`/api/v1/integrations/dronedeploy/imports/${imp.id}`, json({ action: "assign", propertyId: choice[imp.id] })),
                          )
                        }
                      >
                        File
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() =>
                          run(`ignore-${imp.id}`, () =>
                            apiFetch(`/api/v1/integrations/dronedeploy/imports/${imp.id}`, json({ action: "ignore" })),
                          )
                        }
                      >
                        Ignore
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {connection ? (
        <Card>
          <CardHeader title="Imported maps" subtitle="Newest first" />
          <CardBody className="p-0">
            {status.imports.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No maps yet"
                  description="Maps created in DroneDeploy after you connected will appear here once they finish processing."
                />
              </div>
            ) : (
              <ul>
                {status.imports.map((imp) => {
                  const label = STATUS_LABEL[imp.status];
                  return (
                    <li key={imp.id} className="flex flex-col gap-1 border-b border-border px-5 py-3 text-sm last:border-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{imp.planName ?? "Untitled map"}</p>
                        <p className="text-xs text-muted">
                          {imp.planCreatedAt ? formatDate(imp.planCreatedAt) : "Date unknown"}
                          {imp.property ? (
                            <>
                              {" · "}
                              <a className="underline" href={`/properties/${imp.property.id}?tab=exterior`}>
                                {imp.property.name}
                              </a>
                              {imp.matchedBy === "GPS" && imp.matchDistanceMeters !== null
                                ? ` (matched by GPS, ${Math.round(imp.matchDistanceMeters)} m)`
                                : imp.matchedBy === "MANUAL"
                                  ? " (filed by hand)"
                                  : ""}
                            </>
                          ) : null}
                          {imp.exports.length > 0
                            ? ` · ${imp.exports.map((e) => `${e.layer.toLowerCase()} ${e.status.toLowerCase()}`).join(", ")}`
                            : ""}
                        </p>
                        {imp.status === "FAILED" && imp.errorMessage ? (
                          <p className="text-xs text-[var(--band-critical)]">{imp.errorMessage}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${label.className}`}>{label.text}</span>
                        {imp.status === "FAILED" && canManageImports ? (
                          <Button
                            variant="secondary"
                            disabled={busy !== null}
                            onClick={() =>
                              run(`retry-${imp.id}`, () =>
                                apiFetch(`/api/v1/integrations/dronedeploy/imports/${imp.id}`, json({ action: "retry" })),
                              )
                            }
                          >
                            Retry
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
