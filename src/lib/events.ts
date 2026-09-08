import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Canonical application events (spec §23). Every meaningful state change in
 * the domain emits one of these. The Event table is the single source that
 * feeds the property History tab, the dashboard activity feed, and (later)
 * notifications/automation — nothing computes its own parallel history.
 */
export const EVENT_TYPES = {
  PROPERTY_CREATED: "property.created",
  PROPERTY_UPDATED: "property.updated",
  CAPTURE_CREATED: "capture.created",
  CAPTURE_PROCESSING_STARTED: "capture.processing_started",
  CAPTURE_PROCESSING_COMPLETED: "capture.processing_completed",
  CAPTURE_PROCESSING_FAILED: "capture.processing_failed",
  ASSET_CREATED: "asset.created",
  ASSET_UPDATED: "asset.updated",
  ASSET_CONDITION_CHANGED: "asset.condition_changed",
  ASSESSMENT_STARTED: "assessment.started",
  ASSESSMENT_COMPLETED: "assessment.completed",
  ISSUE_CREATED: "issue.created",
  ISSUE_ASSIGNED: "issue.assigned",
  ISSUE_RESOLVED: "issue.resolved",
  DOCUMENT_UPLOADED: "document.uploaded",
  EVIDENCE_UPLOADED: "evidence.uploaded",
  REPORT_GENERATED: "report.generated",
  USER_INVITED: "user.invited",
  PERMISSION_CHANGED: "permission.changed",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export async function emitEvent(params: {
  organizationId: string;
  propertyId?: string | null;
  type: EventType;
  payload?: Record<string, unknown>;
  actorUserId?: string | null;
}) {
  const event = await prisma.event.create({
    data: {
      organizationId: params.organizationId,
      propertyId: params.propertyId ?? null,
      type: params.type,
      payload: (params.payload ?? {}) as unknown as Prisma.InputJsonValue,
      actorUserId: params.actorUserId ?? null,
    },
  });

  // Outbound webhooks (spec §66) fan out from here, for the same reason the
  // Event table exists at all: one choke point. A feature that emits an
  // event gets webhook delivery without knowing webhooks exist.
  //
  // This only ENQUEUES rows — the HTTP calls happen out-of-band. A customer's
  // endpoint being slow or down must never slow down, or roll back, the
  // operation that produced the event. `enqueueEventDeliveries` also swallows
  // its own errors, so a webhook fault cannot fail a business write.
  //
  // Constraint worth knowing before adding a caller: emitEvent writes on the
  // global client, so calling it INSIDE an interactive `$transaction` would
  // enqueue a delivery that survives a rollback — telling a customer's system
  // something happened that then didn't. Every current caller emits after its
  // transaction has committed; keep it that way.
  const { enqueueEventDeliveries } = await import("@/lib/webhooks");
  await enqueueEventDeliveries({
    organizationId: params.organizationId,
    eventId: event.id,
    eventType: params.type,
    payload: { ...(params.payload ?? {}), propertyId: params.propertyId ?? null, eventId: event.id },
  });

  return event;
}
