import { cookies } from "next/headers";
import { z } from "zod";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { IMPERSONATION_COOKIE, MAX_DURATION_MINUTES, startImpersonation } from "@/lib/impersonation";
import { clientIpFromRequest } from "@/lib/rate-limit";

const schema = z.object({
  organizationId: z.string().min(1),
  reason: z.string().min(10, "A reason of at least 10 characters is required — the customer sees it"),
  durationMinutes: z.number().int().positive().max(MAX_DURATION_MINUTES).optional(),
});

// POST /api/v1/admin/impersonation/start — begin a support session (spec §45).
export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canImpersonate");
  const input = schema.parse(await req.json());

  const session = await startImpersonation({
    adminUserId: ctx.userId,
    organizationId: input.organizationId,
    reason: input.reason,
    durationMinutes: input.durationMinutes,
    ipAddress: clientIpFromRequest(req),
  });

  // httpOnly: the session id is an authorization input, so client script has
  // no business reading it. The row is re-checked on every request anyway,
  // which is what makes revocation immediate.
  (await cookies()).set(IMPERSONATION_COOKIE, session.sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });

  return {
    sessionId: session.sessionId,
    organizationId: session.organizationId,
    organizationName: session.organizationName,
    reason: session.reason,
    expiresAt: session.expiresAt,
  };
});
