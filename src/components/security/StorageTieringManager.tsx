"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiFetch, ApiClientError } from "@/lib/api-client";

export interface TieringPolicyView {
  enabled: boolean;
  infrequentAccessAfterDays: number | null;
  archiveAfterDays: number | null;
  deepArchiveAfterDays: number | null;
}

export interface TierUsageView {
  byTier: Record<string, { objects: number; bytes: number }>;
  totalObjects: number;
  totalBytes: number;
}

/**
 * Storage lifecycle tiering (spec §51).
 *
 * The usage breakdown sits beside the policy because the policy on its own
 * tells a customer nothing about whether it is doing anything. The deep
 * archive warning is not decoration either: that tier is the one where
 * reading an object stops being instant, and a customer who discovers that
 * from a stalled download rather than from this screen was misled by us.
 */
const TIER_LABEL: Record<string, string> = {
  STANDARD: "Standard",
  INFREQUENT_ACCESS: "Infrequent access",
  ARCHIVE: "Archive",
  DEEP_ARCHIVE: "Deep archive",
};

const TIER_ORDER = ["STANDARD", "INFREQUENT_ACCESS", "ARCHIVE", "DEEP_ARCHIVE"];

const FIELDS: Array<{
  key: keyof Omit<TieringPolicyView, "enabled">;
  label: string;
  help: string;
}> = [
  {
    key: "infrequentAccessAfterDays",
    label: "Infrequent access after",
    help: "Cheaper storage, same instant access. Retrieval is billed per GB.",
  },
  {
    key: "archiveAfterDays",
    label: "Archive after",
    help: "Much cheaper. Still readable directly, with higher retrieval cost.",
  },
  {
    key: "deepArchiveAfterDays",
    label: "Deep archive after",
    help: "Cheapest tier. Objects must be restored before they can be read, which takes hours.",
  },
];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function StorageTieringManager({
  policy: initialPolicy,
  usage,
  canManagePolicy,
}: {
  policy: TieringPolicyView;
  usage: TierUsageView;
  canManagePolicy: boolean;
}) {
  const router = useRouter();
  const [policy, setPolicy] = useState(initialPolicy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/api/v1/organizations/storage-tiering", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });
      setNotice("Tiering policy saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--band-good)]">{notice}</p> : null}

      <Card>
        <CardHeader
          title="Storage tiering"
          subtitle="Move older captures and documents to cheaper storage classes as they age."
        />
        <CardBody className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              disabled={!canManagePolicy}
              checked={policy.enabled}
              onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })}
            />
            <span className="font-medium text-foreground">Enable tiering for this organization</span>
          </label>
          <p className="text-xs text-muted">
            Nothing moves while this is off. Objects are only ever moved to a colder tier, never back
            — warming an object up again is a restore, not a policy change.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {FIELDS.map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-foreground">{field.label}</label>
                <input
                  type="number"
                  min={0}
                  disabled={!canManagePolicy}
                  value={policy[field.key] ?? ""}
                  placeholder="Never"
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
          <p className="text-xs text-muted">
            Days are measured from when the file was uploaded. Leave a field blank to skip that tier
            entirely. Each threshold must be longer than the one before it.
          </p>

          {canManagePolicy ? (
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving..." : "Save policy"}
            </Button>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Current usage"
          subtitle={`${usage.totalObjects.toLocaleString()} objects, ${formatBytes(usage.totalBytes)}`}
        />
        <CardBody className="p-0">
          <ul>
            {TIER_ORDER.map((tier) => {
              const row = usage.byTier[tier] ?? { objects: 0, bytes: 0 };
              return (
                <li
                  key={tier}
                  className="flex items-center justify-between border-b border-border px-5 py-2.5 text-sm last:border-0"
                >
                  <div>
                    <p className="font-medium text-foreground">{TIER_LABEL[tier]}</p>
                    {tier === "DEEP_ARCHIVE" ? (
                      <p className="text-xs text-muted">Requires a restore before download.</p>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted">
                    {row.objects.toLocaleString()} objects &middot; {formatBytes(row.bytes)}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
