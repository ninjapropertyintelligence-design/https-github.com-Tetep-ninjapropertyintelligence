import { withApiHandler } from "@/lib/api-utils";
import { getMfaStatus } from "@/lib/mfa-service";

// GET /api/v1/auth/mfa — current user's MFA state and org policy.
export const GET = withApiHandler(async (ctx) => {
  return getMfaStatus(ctx.userId, ctx.organizationId || null);
});
