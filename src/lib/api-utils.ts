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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Standard wrapper for API route handlers: resolves the session, converts
 * thrown errors into consistent JSON responses, and never leaks internal
 * error detail to the client. Route handlers should throw ApiError for
 * expected conditions (404, 403, 400) and let anything else become a 500.
 * `extra` forwards Next's dynamic-route second argument (`{ params }`)
 * untouched, since Next 15+/16 params are async (`Promise<{...}>`).
 */
export function withApiHandler<T, Extra = unknown>(
  handler: (ctx: SessionContext, req: Request, extra: Extra) => Promise<T>,
) {
  return async (req: Request, extra: Extra) => {
    try {
      const ctx = await getSessionContext();
      if (!ctx) return jsonError(401, "Not authenticated");
      const result = await handler(ctx, req, extra);
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result);
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
