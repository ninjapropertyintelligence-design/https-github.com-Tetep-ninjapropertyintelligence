import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";

/**
 * Idempotency keys (spec §65).
 *
 * The requirement is stated as an outcome — "repeated requests must not
 * create duplicates" — for file processing, capture creation, issue imports,
 * and webhooks. This implements it the way HTTP APIs conventionally do: the
 * client sends an `Idempotency-Key` header, and a replay of that key returns
 * the ORIGINAL response instead of executing again.
 *
 * Three cases have to be distinguished, and conflating any two of them is
 * how these implementations go wrong:
 *
 *   1. Key never seen      -> claim it, run the handler, store the response.
 *   2. Key seen, completed -> replay the stored response. Nothing re-runs.
 *   3. Key seen, in flight -> a concurrent duplicate. Refuse with 409 rather
 *                             than running a second copy or returning an
 *                             empty body the client would mistake for done.
 *
 * A fourth case is a client bug worth surfacing loudly: the same key sent
 * with a *different* request. That is not a retry, and silently replaying
 * the first response would give the caller a result for an operation they
 * did not ask for.
 */

export const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * How long a key is remembered. Long enough to cover any realistic client
 * retry (including a user re-submitting after a timeout), short enough that
 * a key can eventually be reused and the table doesn't grow forever.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Keys are opaque to us, but an unbounded header is a memory/storage risk. */
const MAX_KEY_LENGTH = 255;

export interface StoredResponse {
  status: number;
  body: unknown;
}

export type IdempotencyOutcome =
  | { kind: "PROCEED"; recordId: string }
  | { kind: "REPLAY"; response: StoredResponse }
  | { kind: "NOT_REQUESTED" };

export function hashRequestBody(body: string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

/**
 * Claims the key for this request, or reports that a stored response should
 * be replayed.
 *
 * The claim is the unique constraint on (organizationId, key): two
 * simultaneous requests race to insert, exactly one wins, and the loser gets
 * a constraint violation it can turn into the 409 above. Checking-then-
 * inserting instead would leave a window where both requests see "no key"
 * and both execute — which is the precise duplicate §65 exists to prevent.
 */
export async function beginIdempotentRequest(params: {
  organizationId: string;
  userId?: string | null;
  key: string;
  method: string;
  path: string;
  body: string;
  now?: Date;
}): Promise<IdempotencyOutcome> {
  const key = params.key.trim();
  if (key.length === 0) return { kind: "NOT_REQUESTED" };
  if (key.length > MAX_KEY_LENGTH) {
    throw new ApiError(400, `Idempotency-Key must be ${MAX_KEY_LENGTH} characters or fewer`);
  }

  const now = params.now ?? new Date();
  const requestHash = hashRequestBody(params.body);

  try {
    const record = await prisma.idempotencyKey.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId ?? null,
        key,
        method: params.method,
        path: params.path,
        requestHash,
        status: "IN_PROGRESS",
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      },
      select: { id: true },
    });
    return { kind: "PROCEED", recordId: record.id };
  } catch (err) {
    // Not a duplicate-key violation — a real database problem.
    if (!isUniqueViolation(err)) throw err;
  }

  const existing = await prisma.idempotencyKey.findUnique({
    where: { organizationId_key: { organizationId: params.organizationId, key } },
  });
  // Vanished between the failed insert and this read (expired and swept).
  // Treat as un-keyed rather than failing the caller's request.
  if (!existing) return { kind: "NOT_REQUESTED" };

  // An expired key is reusable: take it over for this new operation.
  if (existing.expiresAt <= now) {
    await prisma.idempotencyKey.update({
      where: { id: existing.id },
      data: {
        userId: params.userId ?? null,
        method: params.method,
        path: params.path,
        requestHash,
        status: "IN_PROGRESS",
        responseStatus: null,
        responseBody: undefined,
        createdAt: now,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      },
    });
    return { kind: "PROCEED", recordId: existing.id };
  }

  if (existing.method !== params.method || existing.path !== params.path || existing.requestHash !== requestHash) {
    throw new ApiError(
      422,
      "This Idempotency-Key was already used for a different request. Use a new key for a new operation.",
    );
  }

  if (existing.status === "IN_PROGRESS") {
    throw new ApiError(
      409,
      "A request with this Idempotency-Key is still in progress. Retry once it completes.",
    );
  }

  return {
    kind: "REPLAY",
    response: { status: existing.responseStatus ?? 200, body: existing.responseBody ?? null },
  };
}

/** Stores the response so a later replay of this key returns it verbatim. */
export async function completeIdempotentRequest(recordId: string, response: StoredResponse): Promise<void> {
  await prisma.idempotencyKey.updateMany({
    where: { id: recordId },
    data: {
      status: "COMPLETED",
      responseStatus: response.status,
      responseBody: (response.body ?? null) as never,
    },
  });
}

/**
 * Releases a claim whose handler threw. The key becomes usable again, which
 * is what a client retrying after a 500 expects — holding it would make the
 * failure permanent for 24 hours.
 */
export async function releaseIdempotentRequest(recordId: string): Promise<void> {
  await prisma.idempotencyKey.deleteMany({ where: { id: recordId, status: "IN_PROGRESS" } });
}

/** Housekeeping for expired keys; safe to call repeatedly. */
export async function purgeExpiredIdempotencyKeys(now = new Date()): Promise<number> {
  const result = await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lte: now } } });
  return result.count;
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002");
}
