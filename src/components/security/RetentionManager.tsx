"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

export interface RetentionPolicyView {
  activePropertyRetentionDays: number | null;
  deletedPropertyGraceDays: number;
  deletedOrganizationGraceDays: number;
  archivedCaptureRetentionDays: number;
  customerTerminationGraceDays: number;
  backupRetentionDays: number;
}

export interface LegalHoldView {
  id: string;
  scopeType: string;
  reason: string;
  placedAt: string | Date;
  releasedAt: string | Date | null;
  property: { id: string; name: string } | null;
  placedBy: { name: string } | null;
}

export interface DeletionRequestView {
  id: string;
  targetType: string;
  targetLabel: string;
  reason: string;
  status: string;
  requestedAt: string | Date;
  scheduledFor: string | Date;
  executedAt: string | Date | null;
  error: string | null;
  surfaces: Array<{ surface: string; status: string; itemCount: number; detail: string | null }>;
}

/**
 * Retention (spec §52) and secure deletion (spec §54) in one place.
 *
 * The per-surface breakdown is shown rather than a single "deleted" flag on
 * purpose: §54's point is that a deletion has six surfaces and two of them
 * (cache, backups) cannot honestly be reported as done here. Hiding that
 * behind a green tick would be the exact claim the spec warns against.
 */
const POLICY_FIELDS: Array<{ key: keyof RetentionPolicyView; label: string; help: string; nullable?: boolean }> = [
  {
    key: "activePropertyRetentionDays",
    label: "Active property",
    help: "How long history is kept for a property still in service. Blank = keep indefinitely.",
    nullable: true,
  },
  { key: "deletedPropertyGraceDays", label: "Deleted property", help: "Grace window before a deletion runs." },
  { key: "deletedOrganizationGraceDays", label: "Deleted organization", help: "Grace window for a whole organization." },
  { key: "archivedCaptureRetentionDays", label: "Archived capture", help: "How long superseded captures are kept." },
  { key: "customerTerminationGraceDays", label: "Customer termination", help: "Export window after a contract ends." },
  { key: "backupRetentionDays", label: "Backup expiration", help: "How long deleted data survives in backups." },
];

const SURFACE_LABEL: Record<string, string> = {
  DATABASE: "Database",
  OBJECT_STORAGE: "Object storage",
  SEARCH_INDEX: "Search index",
  DERIVED_FILES: "Derived files",
  CACHE: "Cache",
  BACKUP_RETENTION: "Backup retention",
};

export function RetentionManager({
  policy: initialPolicy,
  legalHolds,
  deletionRequests,
  properties,
  canManagePolicy,
  canRequestDeletion,
}: {
  policy: RetentionPolicyView;
  legalHolds: LegalHoldView[];
  deletionRequests: DeletionRequestView[];
  properties: Array<{ id: string; name: string }>;
  canManagePolicy: boolean;
  canRequestDeletion: boolean;
}) {
  const router = useRouter();
  const [policy, setPolicy] = useState(initialPolicy);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [holdPropertyId, setHoldPropertyId] = useState("");
  const [deletePropertyId, setDeletePropertyId] = useState(properties[0]?.id ?? "");
  const [deleteReason, setDeleteReason] = useState("");

  async function run(action: string, fn: () => Promise<unknown>, successMessage?: string) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (successMessage) setNotice(successMessage);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--band-good)]">{notice}</p> : null}

      <Card>
        <CardHeader title="Retention policy" subtitle="How long each category of data is kept, in days." />
        <CardBody className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {POLICY_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-foreground">{field.label}</label>
                <input
                  type="number"
                  min={0}
                  disabled={!canManagePolicy}
                  value={policy[field.key] ?? ""}
                  placeholder={field.nullable ? "Indefinite" : undefined}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      [field.key]: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-background"
                />
                <p className="mt-0.5 text-xs text-muted">{field.help}</p>
              </div>
            ))}
          </div>
          {canManagePolicy ? (
            <Button
              onClick={() =>
                run(
                  "policy",
                  () =>
                    apiFetch("/api/v1/organizations/retention", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(policy),
                    }),
                  "Retention policy saved.",
                )
              }
              disabled={busy === "policy"}
            >
              {busy === "policy" ? "Saving..." : "Save policy"}
            </Button>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Legal holds"
          subtitle="While a hold is active, nothing in scope can be deleted — retention policy does not override it."
        />
        <CardBody className="space-y-3 text-sm">
          {canManagePolicy ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <label className="block text-xs font-medium text-muted">Scope</label>
                <select
                  value={holdPropertyId}
                  onChange={(e) => setHoldPropertyId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
                >
                  <option value="">Entire organization</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[240px] flex-[2]">
                <label className="block text-xs font-medium text-muted">Reason</label>
                <input
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  placeholder="Litigation 2026-14"
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </div>
              <Button
                variant="secondary"
                disabled={busy === "hold" || holdReason.trim().length < 5}
                onClick={() =>
                  run(
                    "hold",
                    () =>
                      apiFetch("/api/v1/organizations/legal-holds", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          scopeType: holdPropertyId ? "PROPERTY" : "ORGANIZATION",
                          propertyId: holdPropertyId || null,
                          reason: holdReason,
                        }),
                      }),
                    "Legal hold placed.",
                  ).then(() => setHoldReason(""))
                }
              >
                {busy === "hold" ? "Placing..." : "Place hold"}
              </Button>
            </div>
          ) : null}

          {legalHolds.length === 0 ? (
            <p className="text-muted">No legal holds have been placed.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {legalHolds.map((hold) => (
                <li key={hold.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <p className="font-medium text-foreground">
                      {hold.property ? hold.property.name : "Entire organization"}
                      {hold.releasedAt ? null : (
                        <span className="ml-2 text-xs font-medium text-[var(--band-critical)]">Active</span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {hold.reason} · placed {formatDateTime(hold.placedAt)}
                      {hold.placedBy ? ` by ${hold.placedBy.name}` : ""}
                      {hold.releasedAt ? ` · released ${formatDateTime(hold.releasedAt)}` : ""}
                    </p>
                  </div>
                  {canManagePolicy && !hold.releasedAt ? (
                    <Button
                      variant="ghost"
                      disabled={busy === `release-${hold.id}`}
                      onClick={() =>
                        run(
                          `release-${hold.id}`,
                          () => apiFetch(`/api/v1/organizations/legal-holds/${hold.id}`, { method: "DELETE" }),
                          "Legal hold released.",
                        )
                      }
                    >
                      Release
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Scheduled deletions"
          subtitle="Deletion is permanent and reaches every surface below. A grace window makes a mistake recoverable."
        />
        <CardBody className="space-y-3 text-sm">
          {canRequestDeletion && properties.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
              <div className="min-w-[200px] flex-1">
                <label className="block text-xs font-medium text-muted">Property</label>
                <select
                  value={deletePropertyId}
                  onChange={(e) => setDeletePropertyId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[240px] flex-[2]">
                <label className="block text-xs font-medium text-muted">Reason</label>
                <input
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Store closed permanently"
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </div>
              <Button
                variant="danger"
                disabled={busy === "delete" || deleteReason.trim().length < 5 || !deletePropertyId}
                onClick={() =>
                  run(
                    "delete",
                    () =>
                      apiFetch(`/api/v1/properties/${deletePropertyId}/deletion`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ reason: deleteReason }),
                      }),
                    "Deletion scheduled.",
                  ).then(() => setDeleteReason(""))
                }
              >
                {busy === "delete" ? "Scheduling..." : "Schedule deletion"}
              </Button>
            </div>
          ) : null}

          {deletionRequests.length === 0 ? (
            <p className="text-muted">No deletions have been requested.</p>
          ) : (
            <ul className="space-y-2">
              {deletionRequests.map((request) => (
                <li key={request.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">
                        {request.targetLabel}{" "}
                        <span className="text-xs font-normal text-muted">({request.targetType.toLowerCase()})</span>
                      </p>
                      <p className="text-xs text-muted">
                        {request.reason} · requested {formatDateTime(request.requestedAt)} ·{" "}
                        {request.executedAt
                          ? `executed ${formatDateTime(request.executedAt)}`
                          : `scheduled for ${formatDateTime(request.scheduledFor)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium ${statusTone(request.status)}`}>{request.status}</span>
                      {request.status === "PENDING" && canRequestDeletion ? (
                        <Button
                          variant="ghost"
                          disabled={busy === `cancel-${request.id}`}
                          onClick={() =>
                            run(
                              `cancel-${request.id}`,
                              () =>
                                apiFetch(`/api/v1/organizations/deletion-requests/${request.id}`, {
                                  method: "DELETE",
                                }),
                              "Deletion cancelled.",
                            )
                          }
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {request.error ? <p className="mt-1 text-xs text-[var(--band-critical)]">{request.error}</p> : null}

                  {request.surfaces.length > 0 ? (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {request.surfaces.map((s) => (
                          <tr key={s.surface} className="border-t border-border">
                            <td className="py-1 pr-3 font-medium text-foreground">
                              {SURFACE_LABEL[s.surface] ?? s.surface}
                            </td>
                            <td className={`py-1 pr-3 ${statusTone(s.status)}`}>{s.status}</td>
                            <td className="py-1 pr-3 tabular-nums text-muted">{s.itemCount}</td>
                            <td className="py-1 text-muted">{s.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function statusTone(status: string): string {
  if (status === "COMPLETED") return "text-[var(--band-good)]";
  if (status === "FAILED" || status === "BLOCKED_BY_LEGAL_HOLD") return "text-[var(--band-critical)]";
  if (status === "SCHEDULED" || status === "PENDING") return "text-[var(--band-needs-attention)]";
  return "text-muted";
}
