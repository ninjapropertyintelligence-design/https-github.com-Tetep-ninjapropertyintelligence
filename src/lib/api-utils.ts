import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  NoOrganizationError,
  SessionContext,
  UnauthenticatedError,
  can,
  getSessionContext,
} from "@/lib/session-context";
import { Permission } from "@/lib/permissions";
import { ApiError } from "@/lib/api-error";

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
    try {
      const ctx = await getSessionContext();
      if (!ctx) return jsonError(401, "Not authenticated");
      const result = await handler(ctx, req, extra);
      if (result instanceof NextResponse) {
        const body = await result.json().catch(() => null);
        return NextResponse.json({ data: body, error: null, meta: {} } satisfies ApiEnvelope<unknown>, { status: result.status });
      }
      return NextResponse.json({ data: result, error: null, meta: {} } satisfies ApiEnvelope<T>);
    } catch (err) {
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
