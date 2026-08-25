import { cookies } from "next/headers";
import { withApiHandler } from "@/lib/api-utils";
import { IMPERSONATION_COOKIE, endImpersonation } from "@/lib/impersonation";

/**
 * POST /api/v1/admin/impersonation/end — leave the customer's account.
 *
 * Note what this does NOT check: `canImpersonate`. While impersonating, the
 * session context is a customer VIEWER by design, so requiring the support
 * permission here would make the exit unreachable. The session id comes
 * from the httpOnly cookie and `endImpersonation` verifies it belongs to
 * this user, which is the real authorization.
 */
export const POST = withApiHandler(async (ctx) => {
  const store = await cookies();
  const sessionId = ctx.impersonation?.sessionId ?? store.get(IMPERSONATION_COOKIE)?.value;
  store.delete(IMPERSONATION_COOKIE);

  if (sessionId) {
    await endImpersonation({ sessionId, adminUserId: ctx.userId });
  }
  return { ended: true };
});
