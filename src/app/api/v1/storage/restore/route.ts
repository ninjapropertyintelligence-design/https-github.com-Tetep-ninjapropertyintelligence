import { z } from "zod";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { requestRestore } from "@/lib/storage-tiering";

const schema = z.object({
  storageKey: z.string().min(1),
  /** S3 bills for the restored copy for as long as it is kept available. */
  availableForDays: z.number().int().min(1).max(30).optional(),
});

/**
 * POST /api/v1/storage/restore — ask the store to make a deep-archived object
 * readable again.
 *
 * Scoped to the caller's organization inside `requestRestore`, which looks the
 * key up by (organizationId, storageKey) rather than trusting the key alone —
 * storage keys are guessable, so treating one as proof of ownership would let
 * any authenticated user thaw another tenant's objects.
 */
export const POST = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageAssets");
  const body = schema.parse(await req.json());
  return requestRestore(ctx, body.storageKey, body.availableForDays);
});
