import { ApiError, withApiHandler } from "@/lib/api-utils";
import { deliverDueWebhooks } from "@/lib/webhooks";

/**
 * POST /api/v1/admin/webhooks/deliver — send every due delivery.
 *
 * The delivery runner. Exposed as an endpoint so the behaviour is operable
 * and testable before a scheduler exists; pointing cron at this is a
 * deployment concern. Platform-admin only: it makes outbound requests on
 * behalf of every organization.
 */
export const POST = withApiHandler(async (ctx) => {
  if (!ctx.isPlatformAdmin) throw new ApiError(403, "Platform admin only");
  const results = await deliverDueWebhooks();
  return { attempted: results.length, results };
});
