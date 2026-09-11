import { redirect } from "next/navigation";
import { can, getSessionContext } from "@/lib/session-context";
import { getTieringPolicy, summarizeStorageByTier } from "@/lib/storage-tiering";
import { StorageTieringManager } from "@/components/security/StorageTieringManager";

/**
 * Storage lifecycle tiering (spec §51). Readable by anyone who can see audit
 * data; the policy controls themselves are gated on billing, since moving a
 * customer's bytes between storage classes changes what they pay and what a
 * download costs them. The API route enforces both again.
 */
export default async function StorageSettingsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.organizationId || !can(ctx, "canViewAuditLogs")) redirect("/dashboard");

  const [policy, usage] = await Promise.all([
    getTieringPolicy(ctx.organizationId),
    summarizeStorageByTier(ctx.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Storage</h1>
        <p className="text-sm text-muted">{ctx.organizationName}</p>
      </div>

      <div className="max-w-4xl">
        <StorageTieringManager
          policy={{
            enabled: policy.enabled,
            infrequentAccessAfterDays: policy.infrequentAccessAfterDays,
            archiveAfterDays: policy.archiveAfterDays,
            deepArchiveAfterDays: policy.deepArchiveAfterDays,
          }}
          usage={usage}
          canManagePolicy={can(ctx, "canManageBilling")}
        />
      </div>
    </div>
  );
}
