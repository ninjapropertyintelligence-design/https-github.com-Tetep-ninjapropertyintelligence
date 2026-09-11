import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { decryptWithKey, deriveKey, encryptWithKey } from "@/lib/crypto";
import { SessionContext } from "@/lib/tenant-scope";
import { EVENT_TYPES, EventType } from "@/lib/events";

/**
 * Outbound integration webhooks (spec §66). The spec names five events and
 * states the purpose plainly — "this prepares for CMMS integration" — so the
 * design target is a receiver written by somebody else, at a company we will
 * never talk to, who needs to trust what arrives.
 *
 * Three properties follow from that:
 *
 *   Signed. Every delivery carries an HMAC-SHA256 signature over
 *   `timestamp.body`. Including the timestamp inside the signed material is
 *   what stops a captured request being replayed later — signing the body
 *   alone would leave a valid payload valid forever.
 *
 *   Retried. A customer's endpoint will be down sometimes. Deliveries retry
 *   with exponential backoff and record every attempt, so "did you send it?"
 *   has an answer.
 *
 *   Idempotent for the receiver. Spec §65 lists webhooks among the
 *   operations that must not duplicate. We cannot control the receiver, but
 *   we can make dedupe possible: the delivery id is stable across retries
 *   and sent as a header, so a receiver that records it can discard repeats.
 *
 * Delivery is out-of-band by design. Rows are enqueued in the same
 * transaction as the event, then sent by a runner — an unreachable customer
 * endpoint must never slow down, or roll back, the operation that produced
 * the event.
 */

/** The five events spec §66 names, plus the near neighbours worth offering. */
export const WEBHOOK_EVENT_TYPES: EventType[] = [
  EVENT_TYPES.ASSET_CREATED,
  EVENT_TYPES.ISSUE_CREATED,
  EVENT_TYPES.ISSUE_RESOLVED,
  EVENT_TYPES.ASSESSMENT_COMPLETED,
  EVENT_TYPES.CAPTURE_PROCESSING_COMPLETED,
  // Not in §66's list, but the same shape and immediately useful to a CMMS.
  EVENT_TYPES.ISSUE_ASSIGNED,
  EVENT_TYPES.ASSET_CONDITION_CHANGED,
  EVENT_TYPES.PROPERTY_CREATED,
];

export const SIGNATURE_HEADER = "x-npi-signature";
export const DELIVERY_ID_HEADER = "x-npi-delivery-id";
export const EVENT_TYPE_HEADER = "x-npi-event-type";

/** Attempt schedule in ms: ~1m, 5m, 30m, 2h, 6h. Then EXHAUSTED. */
export const RETRY_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

/** A dead endpoint retried forever is a cost; auto-disable and say why. */
export const AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES = 20;

const DELIVERY_TIMEOUT_MS = 10_000;
/** Bounded so a hostile endpoint can't stream gigabytes into our log. */
const MAX_STORED_RESPONSE_CHARS = 2_000;

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * `t=<unix seconds>,v1=<hex hmac>` over `${timestamp}.${body}`.
 *
 * Deliberately the same shape Stripe uses: receivers frequently already have
 * code for it, and a familiar format is one less thing for an integrator to
 * get wrong.
 */
export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestampSeconds}.${body}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

/**
 * Verification helper, exported because it is what we hand an integrator —
 * and because a signing scheme nobody has verified against is a guess.
 * Rejects a signature outside the tolerance window even when the HMAC is
 * valid, which is the anti-replay property.
 */
export function verifySignature(params: {
  secret: string;
  body: string;
  header: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean {
  const match = params.header.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (!match) return false;

  const timestamp = Number(match[1]);
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = params.toleranceSeconds ?? 300;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = crypto.createHmac("sha256", params.secret).update(`${timestamp}.${params.body}`).digest("hex");
  const provided = match[2];
  // Equal-length hex strings, so timingSafeEqual is safe and leaks nothing.
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
}

function secretKey(): Buffer {
  const secret = process.env.WEBHOOK_ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("WEBHOOK_ENCRYPTION_KEY (or NEXTAUTH_SECRET) must be set to store webhook secrets");
  return deriveKey(secret, "webhook-secret");
}

export function generateSigningSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("base64url")}`;
}

// ---------------------------------------------------------------------------
// Endpoint management
// ---------------------------------------------------------------------------

/**
 * Registers an endpoint. The signing secret is returned exactly once — it is
 * stored encrypted and cannot be read back, so an integrator who loses it
 * rotates rather than recovers.
 */
export async function createEndpoint(
  ctx: SessionContext,
  input: { url: string; description?: string; eventTypes?: string[] },
): Promise<{ id: string; secret: string }> {
  assertDeliverableUrl(input.url);
  const unknown = (input.eventTypes ?? []).filter((t) => !WEBHOOK_EVENT_TYPES.includes(t as EventType));
  if (unknown.length > 0) {
    throw new ApiError(400, `Unknown event type(s): ${unknown.join(", ")}`);
  }

  const secret = generateSigningSecret();
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      organizationId: ctx.organizationId,
      url: input.url,
      description: input.description ?? null,
      secretEnc: encryptWithKey(secretKey(), secret),
      eventTypes: (input.eventTypes ?? []) as never,
      createdById: ctx.userId,
    },
    select: { id: true },
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "webhook.endpoint_created",
    entityType: "WebhookEndpoint",
    entityId: endpoint.id,
    metadata: { url: input.url, eventTypes: input.eventTypes ?? "all" },
  });

  return { id: endpoint.id, secret };
}

export async function rotateSecret(ctx: SessionContext, endpointId: string): Promise<{ secret: string }> {
  const endpoint = await requireEndpoint(ctx, endpointId);
  const secret = generateSigningSecret();
  await prisma.webhookEndpoint.update({
    where: { id: endpoint.id },
    data: { secretEnc: encryptWithKey(secretKey(), secret) },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "webhook.secret_rotated",
    entityType: "WebhookEndpoint",
    entityId: endpoint.id,
  });
  return { secret };
}

export async function setEndpointEnabled(ctx: SessionContext, endpointId: string, enabled: boolean) {
  const endpoint = await requireEndpoint(ctx, endpointId);
  const updated = await prisma.webhookEndpoint.update({
    where: { id: endpoint.id },
    // Re-enabling clears the failure streak, or an endpoint the customer
    // just fixed would auto-disable again after a couple of attempts.
    data: { enabled, consecutiveFailures: enabled ? 0 : undefined, disabledReason: enabled ? null : "Disabled by user" },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: enabled ? "webhook.endpoint_enabled" : "webhook.endpoint_disabled",
    entityType: "WebhookEndpoint",
    entityId: endpoint.id,
  });
  return updated;
}

export async function deleteEndpoint(ctx: SessionContext, endpointId: string) {
  const endpoint = await requireEndpoint(ctx, endpointId);
  await prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "webhook.endpoint_deleted",
    entityType: "WebhookEndpoint",
    entityId: endpoint.id,
  });
}

export function listEndpoints(ctx: SessionContext) {
  return prisma.webhookEndpoint.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    // secretEnc is deliberately never selected — it must not reach a client.
    select: {
      id: true,
      url: true,
      description: true,
      enabled: true,
      eventTypes: true,
      createdAt: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      consecutiveFailures: true,
      disabledReason: true,
      _count: { select: { deliveries: true } },
    },
  });
}

export function listDeliveries(ctx: SessionContext, endpointId?: string, limit = 50) {
  return prisma.webhookDelivery.findMany({
    where: { organizationId: ctx.organizationId, ...(endpointId ? { endpointId } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

async function requireEndpoint(ctx: SessionContext, endpointId: string) {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, organizationId: ctx.organizationId },
  });
  if (!endpoint) throw new ApiError(404, "Webhook endpoint not found");
  return endpoint;
}

/**
 * Refuses URLs that would make this a server-side request forgery tool.
 * A customer supplies this URL and we then fetch it from inside our network,
 * so loopback and private ranges have to be out of bounds — otherwise a
 * webhook endpoint is a way to probe our internal services.
 */
export function assertDeliverableUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ApiError(400, "That is not a valid URL");
  }

  if (url.protocol !== "https:") {
    // Payloads carry customer property data; plaintext delivery is not
    // acceptable even if the receiver would tolerate it.
    throw new ApiError(400, "Webhook URLs must use https");
  }

  const host = url.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === "[::1]" ||
    host === "::1";

  if (blocked) {
    throw new ApiError(400, "Webhook URLs cannot point at private or loopback addresses");
  }
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/**
 * Queues one delivery per subscribed endpoint. Called from `emitEvent`, so
 * every domain event is a candidate without any feature having to remember
 * to fan out — the same single-choke-point reasoning as the event table
 * itself.
 *
 * Never throws: a webhook problem must not fail the business operation that
 * produced the event.
 */
export async function enqueueEventDeliveries(params: {
  organizationId: string;
  eventId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<number> {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { organizationId: params.organizationId, enabled: true },
      select: { id: true, eventTypes: true },
    });
    if (endpoints.length === 0) return 0;

    const subscribed = endpoints.filter((e) => {
      const types = Array.isArray(e.eventTypes) ? (e.eventTypes as string[]) : [];
      // Empty selection means "everything" — the useful default for a
      // customer who just wants a feed.
      return types.length === 0 || types.includes(params.eventType);
    });
    if (subscribed.length === 0) return 0;

    await prisma.webhookDelivery.createMany({
      data: subscribed.map((e) => ({
        endpointId: e.id,
        organizationId: params.organizationId,
        eventId: params.eventId ?? null,
        eventType: params.eventType,
        payload: params.payload as never,
        status: "PENDING" as const,
        nextAttemptAt: new Date(),
      })),
    });
    return subscribed.length;
  } catch (err) {
    console.error("Failed to enqueue webhook deliveries", err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export interface DeliveryOutcome {
  deliveryId: string;
  status: "SUCCEEDED" | "FAILED" | "EXHAUSTED";
  responseStatus?: number;
  error?: string;
}

/**
 * Sends every delivery that is due. Intended for a scheduled runner; exposed
 * as an admin endpoint so it is operable and testable before one exists —
 * the same choice made for `runDueDeletions`.
 */
export async function deliverDueWebhooks(params?: { now?: Date; limit?: number }): Promise<DeliveryOutcome[]> {
  const now = params?.now ?? new Date();
  const due = await prisma.webhookDelivery.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: now },
      endpoint: { enabled: true },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: params?.limit ?? 50,
    include: { endpoint: true },
  });

  const outcomes: DeliveryOutcome[] = [];
  for (const delivery of due) {
    outcomes.push(await attemptDelivery(delivery.id, now));
  }
  return outcomes;
}

/** One attempt, recording the result either way. */
export async function attemptDelivery(deliveryId: string, now = new Date()): Promise<DeliveryOutcome> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery) throw new ApiError(404, "Delivery not found");

  const attempt = delivery.attempts + 1;
  const body = JSON.stringify({
    id: delivery.id,
    type: delivery.eventType,
    createdAt: delivery.createdAt.toISOString(),
    organizationId: delivery.organizationId,
    data: delivery.payload,
  });

  const timestamp = Math.floor(now.getTime() / 1000);
  let secret: string;
  try {
    secret = decryptWithKey(secretKey(), delivery.endpoint.secretEnc);
  } catch (err) {
    // An undecryptable secret is a configuration fault, not a customer
    // fault. Fail terminally rather than burning retries on it.
    return recordFailure(delivery.id, delivery.endpointId, attempt, {
      error: `Cannot decrypt signing secret: ${err instanceof Error ? err.message : "unknown"}`,
      terminal: true,
      now,
    });
  }

  let responseStatus: number | undefined;
  let responseBody = "";
  try {
    const response = await fetch(delivery.endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SIGNATURE_HEADER]: signPayload(secret, body, timestamp),
        [DELIVERY_ID_HEADER]: delivery.id,
        [EVENT_TYPE_HEADER]: delivery.eventType,
        "User-Agent": "NinjaPropertyIntelligence-Webhooks/1",
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    responseStatus = response.status;
    responseBody = (await response.text().catch(() => "")).slice(0, MAX_STORED_RESPONSE_CHARS);

    if (response.ok) {
      await prisma.$transaction([
        prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "SUCCEEDED",
            attempts: attempt,
            responseStatus,
            responseBody,
            error: null,
            deliveredAt: now,
            nextAttemptAt: null,
          },
        }),
        prisma.webhookEndpoint.update({
          where: { id: delivery.endpointId },
          data: { lastSuccessAt: now, consecutiveFailures: 0 },
        }),
      ]);
      return { deliveryId: delivery.id, status: "SUCCEEDED", responseStatus };
    }

    return recordFailure(delivery.id, delivery.endpointId, attempt, {
      responseStatus,
      responseBody,
      error: `Endpoint returned ${responseStatus}`,
      now,
    });
  } catch (err) {
    return recordFailure(delivery.id, delivery.endpointId, attempt, {
      error: err instanceof Error ? err.message : "Request failed",
      now,
    });
  }
}

async function recordFailure(
  deliveryId: string,
  endpointId: string,
  attempt: number,
  opts: { responseStatus?: number; responseBody?: string; error: string; terminal?: boolean; now: Date },
): Promise<DeliveryOutcome> {
  const exhausted = opts.terminal || attempt >= MAX_ATTEMPTS;
  const backoff = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: exhausted ? "EXHAUSTED" : "FAILED",
      attempts: attempt,
      responseStatus: opts.responseStatus ?? null,
      responseBody: opts.responseBody ?? null,
      error: opts.error,
      nextAttemptAt: exhausted ? null : new Date(opts.now.getTime() + backoff),
    },
  });

  const endpoint = await prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data: { lastFailureAt: opts.now, consecutiveFailures: { increment: 1 } },
    select: { consecutiveFailures: true, enabled: true, organizationId: true },
  });

  if (endpoint.enabled && endpoint.consecutiveFailures >= AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES) {
    await prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: {
        enabled: false,
        disabledReason: `Automatically disabled after ${endpoint.consecutiveFailures} consecutive failures`,
      },
    });
    await writeAuditLog({
      organizationId: endpoint.organizationId,
      actorUserId: null,
      action: "webhook.endpoint_auto_disabled",
      entityType: "WebhookEndpoint",
      entityId: endpointId,
      metadata: { consecutiveFailures: endpoint.consecutiveFailures, lastError: opts.error },
    });
  }

  return {
    deliveryId,
    status: exhausted ? "EXHAUSTED" : "FAILED",
    responseStatus: opts.responseStatus,
    error: opts.error,
  };
}

/** Re-queues a delivery the customer wants to try again, attempts reset. */
export async function replayDelivery(ctx: SessionContext, deliveryId: string) {
  const delivery = await prisma.webhookDelivery.findFirst({
    where: { id: deliveryId, organizationId: ctx.organizationId },
  });
  if (!delivery) throw new ApiError(404, "Delivery not found");

  return prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { status: "PENDING", attempts: 0, error: null, nextAttemptAt: new Date() },
  });
}
