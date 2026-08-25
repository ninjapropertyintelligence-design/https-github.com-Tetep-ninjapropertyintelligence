import { z } from "zod";
import { MFA_ACTION_RULE } from "@/lib/rate-limit";
import { enforceRateLimit, withApiHandler } from "@/lib/api-utils";
import { disableMfa } from "@/lib/mfa-service";

const schema = z.object({ code: z.string().min(1, "A current code is required to disable MFA") });

// POST /api/v1/auth/mfa/disable — turning off the second factor requires
// the second factor.
export const POST = withApiHandler(async (ctx, req) => {
  // A 6-digit code is only 10^6 wide — unlimited guesses would defeat it.
  enforceRateLimit(ctx, req, MFA_ACTION_RULE, "mfa.disable");
  const { code } = schema.parse(await req.json());
  await disableMfa({ userId: ctx.userId, organizationId: ctx.organizationId || null, code });
  return { disabled: true };
});
