import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { Role } from "@/generated/prisma/client";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  purgeExpiredIdempotencyKeys,
  releaseIdempotentRequest,
} from "@/lib/idempotency";
import {
  createEndpoint,
  deliverDueWebhooks,
  enqueueEventDeliveries,
  listEndpoints,
  replayDelivery,
  rotateSecret,
  setEndpointEnabled,
  signPayload,
  verifySignature,
} from "@/lib/webhooks";
import { EVENT_TYPES, emitEvent } from "@/lib/events";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Idempotency (§65) and webhooks (§66) against real Postgres.
 *
 * The load-bearing cases are the ones a single-threaded happy path would
 * miss: two simultaneous requests with the same key, a replay returning the
 * ORIGINAL response rather than re-running, and a failed handler leaving the
 * key usable again.
 */
const suffix = `iw${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };

function ctxFor(orgId: string): SessionContext {
  return {
    userId: user.id,
    userName: "IW User",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: orgId,
    organizationName: "IW Org",
    membershipId: "irrelevant",
    role: Role.OWNER,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `IW Org ${suffix}`, slug: `iw-org-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `IW Other ${suffix}`, slug: `iw-other-${suffix}` } });
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "IW User" } });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: Role.OWNER } });
});

beforeEach(async () => {
  await prisma.idempotencyKey.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
  await prisma.webhookEndpoint.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
  await prisma.user.deleteMany({ where: { id: user.id } });
});

const REQ = { method: "POST", path: "/api/v1/issues", body: '{"title":"Roof leak"}' };

describe("idempotency (spec §65)", () => {
  it("a first request proceeds", async () => {
    const outcome = await beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "k1", ...REQ });
    expect(outcome.kind).toBe("PROCEED");
  });

  it("a replay returns the ORIGINAL response without re-running", async () => {
    const first = await beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "k2", ...REQ });
    if (first.kind !== "PROCEED") throw new Error("expected PROCEED");
    await completeIdempotentRequest(first.recordId, { status: 201, body: { data: { id: "issue_1" }, error: null, meta: {} } });

    const replay = await beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "k2", ...REQ });
    expect(replay.kind).toBe("REPLAY");
    if (replay.kind !== "REPLAY") throw new Error("unreachable");
    expect(replay.response.status).toBe(201);
    expect(replay.response.body).toMatchObject({ data: { id: "issue_1" } });
  });

  it("two SIMULTANEOUS requests with one key: exactly one proceeds", async () => {
    // The case §65 exists for. A check-then-insert would let both through.
    const results = await Promise.allSettled([
      beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "race", ...REQ }),
      beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "race", ...REQ }),
    ]);

    const proceeded = results.filter((r) => r.status === "fulfilled" && r.value.kind === "PROCEED");
    const refused = results.filter((r) => r.status === "rejected");
    expect(proceeded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
    expect(((refused[0] as PromiseRejectedResult).reason as ApiError).status).toBe(409);
  });

  it("an in-flight duplicate is refused with 409, not silently re-run", async () => {
    await beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "inflight", ...REQ });
    await expect(
      beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "inflight", ...REQ }),
    ).rejects.toThrow(/still in progress/);
  });

  it("the same key with a DIFFERENT body is a client bug, reported as 422", async () => {
    // Replaying the first response here would hand the caller a result for
    // an operation they never asked for.
    await beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "k3", ...REQ });
    await expect(
      beginIdempotentRequest({
        organizationId: org.id,
        userId: user.id,
        key: "k3",
        method: "POST",
        path: "/api/v1/issues",
        body: '{"title":"Completely different"}',
      }),
    ).rejects.toThrow(/different request/);
  });

  it("the same key on a different route is also 422", async () => {
    await beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "k4", ...REQ });
    await expect(
      beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "k4", method: "POST", path: "/api/v1/assets", body: REQ.body }),
    ).rejects.toThrow(/different request/);
  });

  it("a failed handler releases the key so a retry can succeed", async () => {
    const first = await beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "k5", ...REQ });
    if (first.kind !== "PROCEED") throw new Error("expected PROCEED");
    await releaseIdempotentRequest(first.recordId);

    // Without the release this would be a permanent 409 for 24 hours.
    const retry = await beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "k5", ...REQ });
    expect(retry.kind).toBe("PROCEED");
  });

  it("keys are scoped per organization — one org cannot collide with another", async () => {
    const a = await beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "shared", ...REQ });
    const b = await beginIdempotentRequest({ organizationId: otherOrg.id, userId: user.id, key: "shared", ...REQ });
    expect(a.kind).toBe("PROCEED");
    expect(b.kind).toBe("PROCEED");
  });

  it("an expired key is reusable for a new operation", async () => {
    const first = await beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "k6", ...REQ });
    if (first.kind !== "PROCEED") throw new Error("expected PROCEED");
    await completeIdempotentRequest(first.recordId, { status: 200, body: { old: true } });
    await prisma.idempotencyKey.update({ where: { id: first.recordId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const reused = await beginIdempotentRequest({
      organizationId: org.id, userId: user.id, key: "k6",
      method: "POST", path: "/api/v1/assets", body: '{"different":true}',
    });
    expect(reused.kind).toBe("PROCEED");
  });

  it("purges expired keys", async () => {
    const rec = await beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "k7", ...REQ });
    if (rec.kind !== "PROCEED") throw new Error("expected PROCEED");
    await prisma.idempotencyKey.update({ where: { id: rec.recordId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await purgeExpiredIdempotencyKeys()).toBeGreaterThanOrEqual(1);
    expect(await prisma.idempotencyKey.findUnique({ where: { id: rec.recordId } })).toBeNull();
  });

  it("an over-long key is rejected rather than stored", async () => {
    await expect(
      beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "x".repeat(300), ...REQ }),
    ).rejects.toThrow(/255 characters/);
  });

  it("an empty key means the caller did not ask for idempotency", async () => {
    expect((await beginIdempotentRequest({ organizationId: org.id, userId: user.id, key: "   ", ...REQ })).kind)
      .toBe("NOT_REQUESTED");
  });
});

describe("webhook endpoints (spec §66)", () => {
  it("returns the signing secret exactly once and never again", async () => {
    const { id, secret } = await createEndpoint(ctxFor(org.id), { url: "https://example.com/hook" });
    expect(secret).toMatch(/^whsec_/);

    // The list view must not carry it — a secret readable from an API is
    // not a secret.
    const listed = await listEndpoints(ctxFor(org.id));
    const found = listed.find((e) => e.id === id)!;
    expect(JSON.stringify(found)).not.toContain(secret);
    expect(found).not.toHaveProperty("secretEnc");
  });

  it("stores the secret encrypted, not in the clear", async () => {
    const { id, secret } = await createEndpoint(ctxFor(org.id), { url: "https://example.com/hook" });
    const row = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id }, select: { secretEnc: true } });
    expect(row.secretEnc).not.toContain(secret);
  });

  it("rotating issues a new secret that verifies, invalidating the old one", async () => {
    const { id, secret: original } = await createEndpoint(ctxFor(org.id), { url: "https://example.com/hook" });
    const { secret: rotated } = await rotateSecret(ctxFor(org.id), id);
    expect(rotated).not.toBe(original);

    const body = '{"hello":"world"}';
    const t = 1_780_000_000;
    const header = signPayload(rotated, body, t);
    expect(verifySignature({ secret: rotated, body, header, nowSeconds: t })).toBe(true);
    expect(verifySignature({ secret: original, body, header, nowSeconds: t })).toBe(false);
  });

  it("refuses an unknown event type instead of silently subscribing to nothing", async () => {
    await expect(
      createEndpoint(ctxFor(org.id), { url: "https://example.com/hook", eventTypes: ["not.a.real.event"] }),
    ).rejects.toThrow(/Unknown event type/);
  });

  it("cannot touch another organization's endpoint", async () => {
    const { id } = await createEndpoint(ctxFor(otherOrg.id), { url: "https://example.com/hook" });
    await expect(rotateSecret(ctxFor(org.id), id)).rejects.toThrow(ApiError);
    await expect(setEndpointEnabled(ctxFor(org.id), id, false)).rejects.toThrow(ApiError);
  });
});

describe("event fan-out", () => {
  it("enqueues one delivery per subscribed endpoint", async () => {
    await createEndpoint(ctxFor(org.id), { url: "https://a.example.com/hook" });
    await createEndpoint(ctxFor(org.id), { url: "https://b.example.com/hook" });

    const queued = await enqueueEventDeliveries({
      organizationId: org.id, eventType: EVENT_TYPES.ISSUE_CREATED, payload: { issueId: "i1" },
    });
    expect(queued).toBe(2);
  });

  it("respects the event filter — an endpoint only gets what it asked for", async () => {
    await createEndpoint(ctxFor(org.id), {
      url: "https://only-resolved.example.com/hook",
      eventTypes: [EVENT_TYPES.ISSUE_RESOLVED],
    });
    expect(await enqueueEventDeliveries({ organizationId: org.id, eventType: EVENT_TYPES.ISSUE_CREATED, payload: {} })).toBe(0);
    expect(await enqueueEventDeliveries({ organizationId: org.id, eventType: EVENT_TYPES.ISSUE_RESOLVED, payload: {} })).toBe(1);
  });

  it("an empty filter means every event", async () => {
    await createEndpoint(ctxFor(org.id), { url: "https://all.example.com/hook", eventTypes: [] });
    expect(await enqueueEventDeliveries({ organizationId: org.id, eventType: EVENT_TYPES.ASSET_CREATED, payload: {} })).toBe(1);
  });

  it("a disabled endpoint receives nothing", async () => {
    const { id } = await createEndpoint(ctxFor(org.id), { url: "https://off.example.com/hook" });
    await setEndpointEnabled(ctxFor(org.id), id, false);
    expect(await enqueueEventDeliveries({ organizationId: org.id, eventType: EVENT_TYPES.ISSUE_CREATED, payload: {} })).toBe(0);
  });

  it("never crosses organizations", async () => {
    await createEndpoint(ctxFor(otherOrg.id), { url: "https://other.example.com/hook" });
    expect(await enqueueEventDeliveries({ organizationId: org.id, eventType: EVENT_TYPES.ISSUE_CREATED, payload: {} })).toBe(0);
  });

  it("emitEvent fans out automatically — a feature gets webhooks for free", async () => {
    await createEndpoint(ctxFor(org.id), { url: "https://auto.example.com/hook" });
    await emitEvent({ organizationId: org.id, type: EVENT_TYPES.ASSET_CREATED, payload: { assetId: "a1" } });

    const deliveries = await prisma.webhookDelivery.findMany({ where: { organizationId: org.id } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].eventType).toBe(EVENT_TYPES.ASSET_CREATED);
    expect(deliveries[0].payload).toMatchObject({ assetId: "a1" });
  });

  it("a webhook fault never fails the business operation that produced the event", async () => {
    // enqueueEventDeliveries swallows its own errors by design. The event
    // must be written even if fan-out cannot be.
    const event = await emitEvent({ organizationId: org.id, type: EVENT_TYPES.PROPERTY_CREATED, payload: { p: 1 } });
    expect(event.id).toBeTruthy();
  });
});

describe("delivery, retry, and replay", () => {
  it("a failing endpoint is retried with backoff, not dropped", async () => {
    // example.invalid is guaranteed non-resolvable (RFC 2606), so this
    // exercises the real failure path without depending on the network.
    const { id } = await createEndpoint(ctxFor(org.id), { url: "https://nonexistent.example.invalid/hook" });
    await enqueueEventDeliveries({ organizationId: org.id, eventType: EVENT_TYPES.ISSUE_CREATED, payload: { i: 1 } });

    const outcomes = await deliverDueWebhooks({ limit: 5 });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("FAILED");

    const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: id } });
    expect(delivery.attempts).toBe(1);
    expect(delivery.status).toBe("FAILED");
    expect(delivery.error).toBeTruthy();
    // Scheduled for later, not retried immediately in a hot loop.
    expect(delivery.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    const endpoint = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id } });
    expect(endpoint.consecutiveFailures).toBe(1);
    expect(endpoint.lastFailureAt).toBeInstanceOf(Date);
  });

  it("only delivers what is actually due", async () => {
    await createEndpoint(ctxFor(org.id), { url: "https://nonexistent.example.invalid/hook" });
    await enqueueEventDeliveries({ organizationId: org.id, eventType: EVENT_TYPES.ISSUE_CREATED, payload: {} });
    await prisma.webhookDelivery.updateMany({
      where: { organizationId: org.id },
      data: { nextAttemptAt: new Date(Date.now() + 3_600_000) },
    });
    expect(await deliverDueWebhooks({ limit: 5 })).toHaveLength(0);
  });

  it("replay re-queues WITHOUT changing the delivery id — the receiver can still dedupe", async () => {
    await createEndpoint(ctxFor(org.id), { url: "https://nonexistent.example.invalid/hook" });
    await enqueueEventDeliveries({ organizationId: org.id, eventType: EVENT_TYPES.ISSUE_CREATED, payload: {} });
    await deliverDueWebhooks({ limit: 5 });

    const before = await prisma.webhookDelivery.findFirstOrThrow({ where: { organizationId: org.id } });
    const replayed = await replayDelivery(ctxFor(org.id), before.id);

    // Spec §65 lists webhooks among the operations that must be idempotent.
    // A replay with a NEW id would defeat receiver-side dedupe entirely.
    expect(replayed.id).toBe(before.id);
    expect(replayed.status).toBe("PENDING");
    expect(replayed.attempts).toBe(0);
  });

  it("cannot replay another organization's delivery", async () => {
    await createEndpoint(ctxFor(otherOrg.id), { url: "https://nonexistent.example.invalid/hook" });
    await enqueueEventDeliveries({ organizationId: otherOrg.id, eventType: EVENT_TYPES.ISSUE_CREATED, payload: {} });
    const foreign = await prisma.webhookDelivery.findFirstOrThrow({ where: { organizationId: otherOrg.id } });
    await expect(replayDelivery(ctxFor(org.id), foreign.id)).rejects.toThrow(ApiError);
  });
});
