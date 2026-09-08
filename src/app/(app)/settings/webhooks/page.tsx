import { redirect } from "next/navigation";
import { can, getSessionContext } from "@/lib/session-context";
import { WEBHOOK_EVENT_TYPES, listDeliveries, listEndpoints } from "@/lib/webhooks";
import { WebhookManager } from "@/components/webhooks/WebhookManager";

/** Outbound integration webhooks (spec §66) — "prepares for CMMS integration". */
export default async function WebhooksPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.organizationId || !can(ctx, "canManageIntegrations")) redirect("/dashboard");

  const [endpoints, deliveries] = await Promise.all([listEndpoints(ctx), listDeliveries(ctx, undefined, 50)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Webhooks</h1>
        <p className="text-sm text-muted">Send events to your own systems as they happen.</p>
      </div>
      <div className="max-w-5xl">
        <WebhookManager
          endpoints={endpoints}
          deliveries={deliveries.map((d) => ({
            id: d.id, eventType: d.eventType, status: d.status, attempts: d.attempts,
            responseStatus: d.responseStatus, error: d.error, createdAt: d.createdAt,
            deliveredAt: d.deliveredAt, nextAttemptAt: d.nextAttemptAt,
          }))}
          availableEventTypes={WEBHOOK_EVENT_TYPES}
        />
      </div>
    </div>
  );
}
