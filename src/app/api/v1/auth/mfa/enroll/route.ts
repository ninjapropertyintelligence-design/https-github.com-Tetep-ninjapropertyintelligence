import { withApiHandler } from "@/lib/api-utils";
import { beginMfaEnrollment } from "@/lib/mfa-service";

// POST /api/v1/auth/mfa/enroll — mint a pending TOTP secret. Returns the
// secret exactly once, in the two forms an authenticator accepts.
export const POST = withApiHandler(async (ctx) => {
  return beginMfaEnrollment({ userId: ctx.userId, userEmail: ctx.userEmail });
});
