import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { SessionContext } from "@/lib/tenant-scope";

/**
 * Organization entitlements.
 *
 * Flags existed as data from the beginning — `FeatureFlag` with a platform
 * default and `FeatureFlagOverride` per organization — and the API route that
 * reads them describes itself as "the single place flags are resolved", but
 * nothing in `src/` ever consulted them before a capture. An organization
 * that had never opted into Matterport could connect Matterport; one without
 * drone processing could create captures. The flags described a product that
 * was not being sold.
 *
 * This is the enforcement point. It is deliberately in the service layer, not
 * the route layer: routes are not the only callers, and an entitlement that
 * holds only on the paths someone remembered to decorate is not an
 * entitlement. Same reasoning as tenant scope.
 */

/**
 * The closed vocabulary. A typo in a flag key would otherwise resolve to
 * "no such flag" and, depending on the default, silently allow or silently
 * deny — so the key set is a type, and an unknown key throws.
 */
export const FEATURE_FLAGS = {
  MATTERPORT: "matterport",
  DRONE_PROCESSING: "drone_processing",
  POINT_CLOUD: "point_cloud",
  OFFLINE_MOBILE: "offline_mobile",
  OWNER_AI: "owner_ai",
  PORTFOLIO_AI: "portfolio_ai",
  COMPUTER_VISION: "computer_vision",
  ENTERPRISE_SSO: "enterprise_sso",
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

/** Human-readable names for the denial message, so the user is told what to buy. */
const FLAG_LABELS: Record<FeatureFlagKey, string> = {
  matterport: "Matterport interior capture",
  drone_processing: "Drone capture and processing",
  point_cloud: "Point cloud / 3D mesh viewer",
  offline_mobile: "Offline-capable field app",
  owner_ai: "Executive AI",
  portfolio_ai: "Portfolio-wide AI",
  computer_vision: "Automated defect detection",
  enterprise_sso: "Enterprise SSO",
};

/**
 * Resolves every flag for one organization: the platform default, overridden
 * per organization where a row exists.
 *
 * A null organizationId (a platform admin outside any organization) resolves
 * to platform defaults, because there is no organization whose entitlement
 * could apply.
 */
export async function resolveFeatureFlags(organizationId: string | null): Promise<Record<string, boolean>> {
  const [flags, overrides] = await Promise.all([
    prisma.featureFlag.findMany(),
    organizationId
      ? prisma.featureFlagOverride.findMany({ where: { organizationId } })
      : Promise.resolve([]),
  ]);
  const overrideByKey = new Map(overrides.map((o) => [o.flagKey, o.enabled]));
  return Object.fromEntries(flags.map((f) => [f.key, overrideByKey.get(f.key) ?? f.defaultEnabled]));
}

/**
 * Whether one feature is on for one organization.
 *
 * A flag key with no row at all returns FALSE, not true. An entitlement that
 * defaults to "allowed" when its definition is missing is how a paid feature
 * gets given away by a failed migration.
 */
export async function isFeatureEnabled(
  organizationId: string | null,
  key: FeatureFlagKey,
): Promise<boolean> {
  const flag = await prisma.featureFlag.findUnique({ where: { key } });
  if (!flag) return false;
  if (!organizationId) return flag.defaultEnabled;

  const override = await prisma.featureFlagOverride.findUnique({
    where: { flagKey_organizationId: { flagKey: key, organizationId } },
  });
  return override?.enabled ?? flag.defaultEnabled;
}

/**
 * Throws 403 unless the caller's organization is entitled to the feature.
 *
 * Platform admins are NOT exempt. An entitlement describes what the
 * organization bought, not how powerful the person looking at it is — and
 * support staff acting inside a customer's account should see exactly what
 * that customer can do. Impersonation especially: the whole point is to
 * reproduce the customer's experience.
 */
export async function requireFeature(ctx: SessionContext, key: FeatureFlagKey): Promise<void> {
  if (await isFeatureEnabled(ctx.organizationId || null, key)) return;
  throw new ApiError(
    403,
    `${FLAG_LABELS[key]} is not enabled for your organization. Contact your administrator to add it to your plan.`,
  );
}
