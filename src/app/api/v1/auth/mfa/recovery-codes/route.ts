import { z } from "zod";
import { MFA_ACTION_RULE } from "@/lib/rate-limit";
import { enforceRateLimit, withApiHandler } from "@/lib/api-utils";
import { regenerateRecoveryCodes } from "@/lib/mfa-service";

const schema = z.object({ code: z.string().min(1, "A current code is required") });

// POST /api/v1/auth/mfa/recovery-codes — issue a fresh set, invalidating
// the previous one.
export const POST = withApiHandler(async (ctx, req) => {
  // A 6-digit code is only 10^6 wide — unlimited guesses would defeat it.
  enforceRateLimit(ctx, req, MFA_ACTION_RULE, "mfa.recovery_codes");
  const { code } = schema.parse(await req.json());
  return regenerateRecoveryCodes({ userId: ctx.userId, organizationId: ctx.organizationId || null, code });
});
