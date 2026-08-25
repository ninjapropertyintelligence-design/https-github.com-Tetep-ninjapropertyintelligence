import { z } from "zod";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { setOrganizationMfaPolicy } from "@/lib/mfa-service";

const schema = z.object({ requireMfa: z.boolean() });

// PUT /api/v1/organizations/mfa-policy — org-wide "everyone must use MFA".
// Gated on canManageTeam: it's a membership policy, not a billing one.
export const PUT = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageTeam");
  const { requireMfa } = schema.parse(await req.json());
  return setOrganizationMfaPolicy({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    requireMfa,
  });
});
