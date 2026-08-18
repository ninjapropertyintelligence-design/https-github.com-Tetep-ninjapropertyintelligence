import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api-utils";

/**
 * Effective feature flags for the caller's organization: platform default
 * (`FeatureFlag.defaultEnabled`) unless a per-org `FeatureFlagOverride`
 * exists. This is the single place flags are resolved — UI and API code
 * should call this (or the equivalent server helper) rather than hard-coding
 * flag checks.
 */
export const GET = withApiHandler(async (ctx) => {
  const [flags, overrides] = await Promise.all([
    prisma.featureFlag.findMany(),
    ctx.organizationId
      ? prisma.featureFlagOverride.findMany({ where: { organizationId: ctx.organizationId } })
      : Promise.resolve([]),
  ]);
  const overrideByKey = new Map(overrides.map((o) => [o.flagKey, o.enabled]));
  const effective = Object.fromEntries(
    flags.map((f) => [f.key, overrideByKey.get(f.key) ?? f.defaultEnabled]),
  );
  return NextResponse.json({ flags: effective });
});
