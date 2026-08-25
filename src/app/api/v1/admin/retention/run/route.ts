import { ApiError, withApiHandler } from "@/lib/api-utils";
import { runDueDeletions } from "@/lib/retention";

/**
 * POST /api/v1/admin/retention/run — execute every deletion whose grace
 * window has elapsed.
 *
 * This is the job runner. It is exposed as an endpoint so the behaviour is
 * operable and testable today; a scheduler calling it on a timer is a
 * deployment concern, not a code one. Platform-admin only: it destroys data
 * across organizations.
 */
export const POST = withApiHandler(async (ctx) => {
  if (!ctx.isPlatformAdmin) throw new ApiError(403, "Platform admin only");
  const results = await runDueDeletions();
  return { executed: results.length, results };
});
