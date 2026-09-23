import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { resolveFeatureFlags } from "@/lib/feature-flags";

/**
 * Effective feature flags for the caller's organization: platform default
 * (`FeatureFlag.defaultEnabled`) unless a per-org `FeatureFlagOverride`
 * exists.
 *
 * Resolution lives in `lib/feature-flags.ts`, which is also what the services
 * enforce with. This route used to resolve them itself and claim in a comment
 * to be "the single place flags are resolved" — which was true only because
 * nothing else read them at all. Two copies of the rule would be worse than
 * one: the UI could show a feature as available while the service refused it.
 */
export const GET = withApiHandler(async (ctx) => {
  return NextResponse.json({ flags: await resolveFeatureFlags(ctx.organizationId || null) });
});
