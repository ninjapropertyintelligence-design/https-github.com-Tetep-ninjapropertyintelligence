"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { SeverityBadge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface AvailableSpace {
  externalSpaceId: string;
  name: string | null;
  status: string;
  capturedAt: string | null;
}

export interface InteriorStatusData {
  providerConfigured: boolean;
  connectionStatus: string;
  connectionError: string | null;
  lastSync: string | null;
  link: {
    id: string;
    linkedAt: string;
    operator: string | null;
    space: { externalSpaceId: string; name: string | null; status: string; capturedAt: string | null; syncedAt: string | null };
    references: Array<{ id: string; label: string | null; asset: { id: string; name: string } | null }>;
    viewerConfig: { embedUrl: string | null; usesSdk: boolean } | null;
  } | null;
  sidePanel: {
    areas: Array<{ id: string; name: string }>;
    assets: Array<{ id: string; name: string; assetType: string }>;
    issues: Array<{ id: string; title: string; severity: string }>;
    evidence: Array<{ id: string; type: string }>;
  };
}

const STATUS_LABEL: Record<string, string> = {
  NOT_CONFIGURED: "Not Configured",
  DISCONNECTED: "Not Connected",
  CONNECTED: "Connected",
  ERROR: "Error",
};

export function InteriorManager({
  propertyId,
  data,
  canManageIntegrations,
  canPerformCapture,
}: {
  propertyId: string;
  data: InteriorStatusData;
  canManageIntegrations: boolean;
  canPerformCapture: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availableSpaces, setAvailableSpaces] = useState<AvailableSpace[] | null>(null);

  async function call(action: string, url: string, body?: unknown) {
    setLoading(action);
    setError(null);
    try {
      await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setLoading(null);
    }
  }

  async function loadSpaces() {
    setLoading("list-spaces");
    setError(null);
    try {
      const body = await apiFetch<{ items: AvailableSpace[] }>("/api/v1/integrations/matterport/spaces");
      setAvailableSpaces(body.items);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Interior Capture"
          subtitle="Matterport is a capture provider, not core architecture — other providers can plug in behind the same InteriorCaptureProvider interface."
        />
        <CardBody className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span><span className="text-muted">Provider:</span> Matterport</span>
            <span>
              <span className="text-muted">Status:</span>{" "}
              <span
                className={
                  data.connectionStatus === "CONNECTED"
                    ? "font-medium text-[var(--band-good)]"
                    : data.connectionStatus === "ERROR"
                      ? "font-medium text-[var(--band-critical)]"
                      : "font-medium text-muted"
                }
              >
                {STATUS_LABEL[data.connectionStatus] ?? data.connectionStatus}
              </span>
            </span>
            <span><span className="text-muted">Last Sync:</span> {formatDate(data.lastSync)}</span>
            {data.link ? (
              <>
                <span><span className="text-muted">Capture Date:</span> {formatDate(data.link.space.capturedAt)}</span>
                <span><span className="text-muted">Space ID:</span> {data.link.space.externalSpaceId}</span>
              </>
            ) : null}
          </div>

          {data.connectionError ? <p className="text-sm text-[var(--band-critical)]">{data.connectionError}</p> : null}
          {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}

          {!data.providerConfigured ? (
            <EmptyState
              title="Matterport is not configured"
              description="Set MATTERPORT_API_TOKEN, MATTERPORT_API_SECRET (and optionally MATTERPORT_SDK_KEY) to enable this integration. Everything else — the connection state machine, linking, sync, and this UI — is fully built and ready."
            />
          ) : data.connectionStatus !== "CONNECTED" ? (
            canManageIntegrations ? (
              <Button onClick={() => call("connect", "/api/v1/integrations/matterport/connect")} disabled={loading === "connect"}>
                {loading === "connect" ? "Connecting..." : data.connectionStatus === "ERROR" ? "Retry Connection" : "Connect Matterport"}
              </Button>
            ) : (
              <p className="text-muted">Ask an org admin to connect Matterport for your organization.</p>
            )
          ) : !data.link ? (
            canPerformCapture ? (
              <div className="space-y-2">
                <Button variant="secondary" onClick={loadSpaces} disabled={loading === "list-spaces"}>
                  {loading === "list-spaces" ? "Loading spaces..." : "Browse Matterport Spaces"}
                </Button>
                {availableSpaces ? (
                  availableSpaces.length === 0 ? (
                    <p className="text-muted">No spaces found on this Matterport account.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {availableSpaces.map((s) => (
                        <li key={s.externalSpaceId} className="flex items-center justify-between px-3 py-2">
                          <span>{s.name ?? s.externalSpaceId}</span>
                          <Button
                            variant="secondary"
                            onClick={() => call("link", `/api/v1/properties/${propertyId}/interior/link`, { externalSpaceId: s.externalSpaceId })}
                            disabled={loading === "link"}
                          >
                            Link to this property
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </div>
            ) : (
              <p className="text-muted">No interior capture linked to this property yet.</p>
            )
          ) : (
            <div className="space-y-3">
              {data.link.viewerConfig?.embedUrl ? (
                <iframe src={data.link.viewerConfig.embedUrl} className="h-96 w-full rounded-lg border border-border" allow="xr-spatial-tracking" allowFullScreen />
              ) : (
                <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border bg-background text-sm text-muted">
                  Viewer unavailable — check the connection status above.
                </div>
              )}
              {canPerformCapture ? (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => call("sync", `/api/v1/properties/${propertyId}/interior/sync`)} disabled={loading === "sync"}>
                    {loading === "sync" ? "Syncing..." : "Sync"}
                  </Button>
                  <Button variant="ghost" onClick={() => call("disconnect", `/api/v1/properties/${propertyId}/interior/disconnect`)} disabled={loading === "disconnect"}>
                    {loading === "disconnect" ? "Disconnecting..." : "Disconnect (keeps property)"}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>

      {data.link ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <SidePanelCard title="Areas" items={data.sidePanel.areas.map((a) => ({ key: a.id, label: a.name }))} />
          <SidePanelCard
            title="Assets"
            items={data.sidePanel.assets.map((a) => ({ key: a.id, label: a.name, href: `/assets/${a.id}` }))}
          />
          <SidePanelCard
            title="Issues"
            items={data.sidePanel.issues.map((i) => ({ key: i.id, label: i.title, href: `/issues/${i.id}`, badge: <SeverityBadge severity={i.severity} /> }))}
          />
          <SidePanelCard title="Evidence" items={data.sidePanel.evidence.map((e) => ({ key: e.id, label: e.type.replace(/_/g, " ") }))} />
        </div>
      ) : null}
    </div>
  );
}

function SidePanelCard({ title, items }: { title: string; items: Array<{ key: string; label: string; href?: string; badge?: React.ReactNode }> }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="p-0">
        {items.length === 0 ? (
          <p className="p-4 text-xs text-muted">None</p>
        ) : (
          <ul>
            {items.slice(0, 20).map((item) => (
              <li key={item.key} className="flex items-center justify-between border-b border-border px-4 py-2 text-sm last:border-0">
                {item.href ? (
                  <Link href={item.href} className="text-foreground hover:text-brand">
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-foreground">{item.label}</span>
                )}
                {item.badge}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
