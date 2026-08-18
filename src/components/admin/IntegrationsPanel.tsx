"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatRelativeTime } from "@/lib/format";

export interface IntegrationsOverview {
  aiProvider: { name: string; configured: boolean };
  matterportConnections: Array<{ id: string; status: string; errorMessage: string | null; lastSyncedAt: string | null; organization: { name: string } }>;
  failedCaptures: Array<{ id: string; notes: string | null; updatedAt: string; property: { name: string } }>;
  failedProcessingJobs: Array<{ id: string; errorMessage: string | null; updatedAt: string; dataset: { capture: { property: { name: string } } } }>;
  failedDocuments: Array<{ id: string; title: string; indexError: string | null; property: { name: string } | null }>;
}

export function IntegrationsPanel({ data }: { data: IntegrationsOverview }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function retry(action: string, url: string) {
    setBusy(action);
    await fetch(url, { method: "POST" });
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="AI Provider" />
        <CardBody className="text-sm">
          <p>
            <span className="text-muted">Selected provider:</span> <span className="font-medium">{data.aiProvider.name}</span>
          </p>
          <p>
            <span className="text-muted">Status:</span>{" "}
            <span className={data.aiProvider.configured ? "font-medium text-[var(--band-good)]" : "font-medium text-muted"}>
              {data.aiProvider.configured ? "Configured" : "Not configured"}
            </span>
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Matterport Connections" />
        <CardBody className="p-0">
          {data.matterportConnections.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No organizations have attempted a Matterport connection yet" />
            </div>
          ) : (
            <ul>
              {data.matterportConnections.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
                  <div>
                    <p className="font-medium text-foreground">{c.organization.name}</p>
                    <p className="text-xs text-muted">
                      {c.status}
                      {c.lastSyncedAt ? ` · synced ${formatRelativeTime(c.lastSyncedAt)}` : ""}
                      {c.errorMessage ? ` · ${c.errorMessage}` : ""}
                    </p>
                  </div>
                  {c.status === "ERROR" ? (
                    <Button variant="secondary" onClick={() => retry(c.id, `/api/admin/matterport/${c.id}/retry`)} disabled={busy === c.id}>
                      {busy === c.id ? "Retrying..." : "Retry"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Failed Drone Captures" />
        <CardBody className="p-0">
          {data.failedCaptures.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No failed captures" />
            </div>
          ) : (
            <ul>
              {data.failedCaptures.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
                  <div>
                    <p className="font-medium text-foreground">{c.property.name}</p>
                    <p className="text-xs text-muted">{c.notes ?? "No error detail"}</p>
                  </div>
                  <Button variant="secondary" onClick={() => retry(c.id, `/api/admin/drone-captures/${c.id}/retry`)} disabled={busy === c.id}>
                    {busy === c.id ? "Retrying..." : "Retry"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Failed Document Indexing" />
        <CardBody className="p-0">
          {data.failedDocuments.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No failed indexing jobs" />
            </div>
          ) : (
            <ul>
              {data.failedDocuments.map((d) => (
                <li key={d.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
                  <div>
                    <p className="font-medium text-foreground">{d.title}</p>
                    <p className="text-xs text-muted">
                      {d.property?.name ?? "—"} · {d.indexError ?? "Unknown error"}
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => retry(d.id, `/api/admin/documents/${d.id}/reindex`)} disabled={busy === d.id}>
                    {busy === d.id ? "Reindexing..." : "Reindex"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
