import { redirect } from "next/navigation";
import { can, getSessionContext, propertyScopeWhere } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { getRetentionPolicy, listDeletionRequests, listLegalHolds } from "@/lib/retention";
import { RetentionManager } from "@/components/security/RetentionManager";
import { recordProductEvent } from "@/lib/analytics";

/**
 * Data retention and deletion (spec §52/§54). Gated on canViewAuditLogs to
 * read; the destructive controls inside are separately gated and enforced
 * again on every API route.
 */
export default async function RetentionSettingsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.organizationId || !can(ctx, "canViewAuditLogs")) redirect("/dashboard");

  // Product analytics (§105). Awaited but never able to throw, and
  // flagged automatically when the viewer is support impersonating.
  await recordProductEvent(ctx, "retention_settings.viewed");
  const [policy, legalHolds, deletionRequests, properties] = await Promise.all([
    getRetentionPolicy(ctx.organizationId),
    listLegalHolds(ctx),
    listDeletionRequests(ctx),
    // Scoped, not "all properties in the org": a scoped role must not be
    // offered a property it cannot otherwise see.
    prisma.property.findMany({
      where: { ...propertyScopeWhere(ctx), retentionStatus: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Data Retention &amp; Deletion</h1>
        <p className="text-sm text-muted">{ctx.organizationName}</p>
      </div>

      <div className="max-w-4xl">
        <RetentionManager
          policy={{
            activePropertyRetentionDays: policy.activePropertyRetentionDays,
            deletedPropertyGraceDays: policy.deletedPropertyGraceDays,
            deletedOrganizationGraceDays: policy.deletedOrganizationGraceDays,
            archivedCaptureRetentionDays: policy.archivedCaptureRetentionDays,
            customerTerminationGraceDays: policy.customerTerminationGraceDays,
            backupRetentionDays: policy.backupRetentionDays,
          }}
          legalHolds={legalHolds}
          deletionRequests={deletionRequests}
          properties={properties}
          canManagePolicy={can(ctx, "canManageBilling")}
          canRequestDeletion={can(ctx, "canManageProperties")}
        />
      </div>
    </div>
  );
}
