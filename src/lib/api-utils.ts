import { NextResponse } from "next/server";
import { normalizeBigInts } from "@/lib/json-safe";
import { ZodError } from "zod";
import {
  NoOrganizationError,
  SessionContext,
  UnauthenticatedError,
  can,
  getSessionContext,
  mfaPolicySatisfied,
} from "@/lib/session-context";
import { Permission } from "@/lib/permissions";
import { ApiError } from "@/lib/api-error";
import { RateLimitRule, checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit";
import {
  IDEMPOTENCY_HEADER,
  beginIdempotentRequest,
  completeIdempotentRequest,
  releaseIdempotentRequest,
} from "@/lib/idempotency";

export { ApiError };

/**
 * Every JSON API response — success or error — uses this envelope (spec
 * §63 "API Standards"). `data` carries the payload, `error` is a message
 * string or null, `meta` is reserved for pagination/rate-limit info a
 * route wants to attach later. Binary responses (signed file downloads,
 * generated PDFs/CSVs) are exempt — the envelope only applies to JSON.
 */
export interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
  meta: Record<string, unknown>;
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ data: null, error: message, meta: {} } satisfies ApiEnvelope<null>, { status });
}

/**
 * Standard wrapper for API route handlers: resolves the session, converts
 * thrown errors into consistent JSON responses, and never leaks internal
 * error detail to the client. Route handlers should throw ApiError for
 * expected conditions (404, 403, 400) and let anything else become a 500.
 * `extra` forwards Next's dynamic-route second argument (`{ params }`)
 * untouched, since Next 15+/16 params are async (`Promise<{...}>`).
 *
 * Route handlers may return either a plain value (auto-wrapped as
 * `{data: value, error: null, meta: {}}`) or a `NextResponse` they built
 * themselves — e.g. `NextResponse.json(x, {status: 201})` for a non-200
 * status — in which case its JSON body is read back out and wrapped the
 * same way, preserving the original status. This keeps every one of this
 * project's ~50 route files free of envelope boilerplate; only this one
 * function needs to know the envelope shape.
 */
export function withApiHandler<T, Extra = unknown>(
  handler: (ctx: SessionContext, req: Request, extra: Extra) => Promise<T>,
) {
  return async (req: Request, extra: Extra) => {
    // Declared outside the try so the catch can release a claimed key.
    let idempotencyRecordId: string | null = null;
    let rawBody = "";
    try {
      const ctx = await getSessionContext();
      if (!ctx) return jsonError(401, "Not authenticated");
      if (!mfaPolicySatisfied(ctx) && !isMfaEnrollmentPath(req)) {
        // The org requires a second factor and this user has none. Enforced
        // here as well as in the app layout, so the policy holds for a
        // direct API call that never renders a page.
        return jsonError(
          403,
          "Your organization requires multi-factor authentication. Enrol at /settings/security to continue.",
        );
      }
      if (ctx.impersonation && !isReadOnlyRequest(req) && !isImpersonationControlPath(req)) {
        // Spec §45 says support may *view* a customer's account. This makes
        // that literal: while impersonating, nothing can be written. The
        // VIEWER role already blocks permission-gated mutations; this also
        // covers a route that happens not to gate on one.
        return jsonError(
          403,
          "Read-only: platform support cannot modify customer data while impersonating.",
        );
      }
      // Idempotency (spec §65). Only mutating requests take a key: a GET is
      // already idempotent by definition, and caching one here would be a
      // response cache wearing the wrong name.
      const idempotencyKey = isReadOnlyRequest(req) ? null : req.headers.get(IDEMPOTENCY_HEADER);

      if (idempotencyKey && ctx.organizationId) {
        // The body has to be read to hash it, and a Request body can only be
        // read once — so the handler is given a fresh Request wrapping the
        // text we already consumed. Without this, every keyed route would
        // see an empty body.
        rawBody = await req.text();
        req = new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body: rawBody.length > 0 ? rawBody : undefined,
        });

        const outcome = await beginIdempotentRequest({
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          key: idempotencyKey,
          method: req.method,
          path: new URL(req.url).pathname,
          body: rawBody,
        });

        if (outcome.kind === "REPLAY") {
          // The original response, verbatim, including its status. The
          // header tells the client this did not re-execute.
          return NextResponse.json(outcome.response.body as ApiEnvelope<unknown>, {
            status: outcome.response.status,
            headers: { "Idempotency-Replayed": "true" },
          });
        }
        if (outcome.kind === "PROCEED") idempotencyRecordId = outcome.recordId;
      }

      const result = await handler(ctx, req, extra);

      // Binary and redirect responses are not envelope endpoints.
      //
      // §63's {data, error, meta} shape describes the JSON API. A file's
      // bytes cannot travel inside it, and the code below used to try anyway:
      // it parsed the response body as JSON, got null for a JPEG, and
      // returned an envelope with the file silently dropped — a 200 carrying
      // {"data":null}. Passing a non-JSON response through untouched is what
      // lets a route serve a file while still getting the session, MFA and
      // impersonation checks above, instead of hand-rolling them.
      if (result instanceof NextResponse && !isJsonResponse(result)) {
        // A read-only request never claims a key, so this is only reachable
        // for a keyed mutation that answers with a file. Recording the status
        // with no body keeps the claim from being left in progress forever;
        // a replay of such a key returns the status, not the bytes.
        if (idempotencyRecordId) {
          await completeIdempotentRequest(idempotencyRecordId, { status: result.status, body: null });
        }
        return result;
      }

      let status = 200;
      let envelope: ApiEnvelope<unknown>;
      if (result instanceof NextResponse) {
        const body = await result.json().catch(() => null);
        status = result.status;
        envelope = { data: body, error: null, meta: {} };
      } else {
        envelope = { data: result, error: null, meta: {} };
      }

      // Before the envelope reaches either JSON.stringify or the idempotency
      // store, both of which throw on a BigInt.
      envelope = normalizeBigInts(envelope) as ApiEnvelope<unknown>;

      if (idempotencyRecordId) {
        await completeIdempotentRequest(idempotencyRecordId, { status, body: envelope });
      }
      return NextResponse.json(envelope, { status });
    } catch (err) {
      // A failed handler must release its claim, or a client retrying after
      // a 500 would be told the key is still in progress — forever.
      if (idempotencyRecordId) {
        await releaseIdempotentRequest(idempotencyRecordId).catch(() => {});
      }
      if (err instanceof ApiError) return jsonError(err.status, err.message);
      if (err instanceof UnauthenticatedError) return jsonError(401, err.message);
      if (err instanceof NoOrganizationError) return jsonError(403, err.message);
      if (err instanceof ZodError) {
        return jsonError(400, err.issues.map((i) => i.message).join("; "));
      }
      console.error("Unhandled API error", err);
      return jsonError(500, "Internal server error");
    }
  };
}

export function requirePermission(ctx: SessionContext, permission: Permission) {
  if (!can(ctx, permission)) {
    throw new ApiError(403, `Missing permission: ${permission}`);
  }
}

export function requireOrgContext(ctx: SessionContext) {
  if (!ctx.organizationId) {
    throw new ApiError(403, "No organization context");
  }
}

/**
 * The enrollment endpoints must stay reachable while the policy is
 * unsatisfied, or a user under a newly-enabled policy could never comply.
 * Matched on the path prefix rather than a per-route opt-out flag so a new
 * MFA route can't be added without inheriting the exemption.
 */
function isMfaEnrollmentPath(req: Request): boolean {
  try {
    return new URL(req.url).pathname.startsWith("/api/v1/auth/mfa");
  } catch {
    return false;
  }
}

/**
 * Applies a rate-limit rule to an authenticated request, keyed on the user
 * (not just the address — a session is the thing being spent here). Throws
 * a 429 ApiError, which `withApiHandler` renders in the standard envelope.
 */
export function enforceRateLimit(
  ctx: SessionContext,
  req: Request,
  rule: RateLimitRule,
  action: string,
): void {
  const result = checkRateLimit(`${action}:user:${ctx.userId}`, rule);
  const byIp = checkRateLimit(`${action}:ip:${clientIpFromRequest(req)}`, rule);
  if (!result.allowed || !byIp.allowed) {
    const wait = Math.max(result.retryAfterSeconds, byIp.retryAfterSeconds);
    throw new ApiError(429, `Too many attempts. Try again in ${wait} second${wait === 1 ? "" : "s"}.`);
  }
}

/**
 * Whether a response carries the JSON envelope. Absent or non-JSON means the
 * route is deliberately serving something else — a file, or a redirect.
 */
function isJsonResponse(res: NextResponse): boolean {
  return (res.headers.get("content-type") ?? "").includes("application/json");
}

function isReadOnlyRequest(req: Request): boolean {
  return req.method === "GET" || req.method === "HEAD";
}

/** Ending an impersonation session is the one write it must always allow. */
function isImpersonationControlPath(req: Request): boolean {
  try {
    return new URL(req.url).pathname === "/api/v1/admin/impersonation/end";
  } catch {
    return false;
  }
}
