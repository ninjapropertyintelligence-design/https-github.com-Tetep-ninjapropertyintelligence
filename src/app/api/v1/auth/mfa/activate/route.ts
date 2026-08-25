import { z } from "zod";
import { MFA_ACTION_RULE } from "@/lib/rate-limit";
import { enforceRateLimit, withApiHandler } from "@/lib/api-utils";
import { activateMfa } from "@/lib/mfa-service";

const schema = z.object({ code: z.string().min(1, "Enter the code from your authenticator app") });

// POST /api/v1/auth/mfa/activate — prove the secret works, then enable MFA
// and issue recovery codes (returned once, stored hashed).
export const POST = withApiHandler(async (ctx, req) => {
  // A 6-digit code is only 10^6 wide — unlimited guesses would defeat it.
  enforceRateLimit(ctx, req, MFA_ACTION_RULE, "mfa.activate");
  const { code } = schema.parse(await req.json());
  return activateMfa({ userId: ctx.userId, organizationId: ctx.organizationId || null, code });
});
