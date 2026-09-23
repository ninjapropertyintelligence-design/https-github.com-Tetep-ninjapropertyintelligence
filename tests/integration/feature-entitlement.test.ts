import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { FEATURE_FLAGS, isFeatureEnabled, requireFeature, resolveFeatureFlags } from "@/lib/feature-flags";
import { createDroneCapture } from "@/lib/drone-service";
import {
  connectMatterportForOrg,
  linkSpaceByIdDirect,
  disconnectPropertyInterior,
  getPropertyInteriorStatus,
} from "@/lib/matterport-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Entitlement enforcement.
 *
 * Flags were stored and displayed but never consulted, so every organization
 * could use every integration regardless of what it had bought. These pin the
 * enforcement down — and, as importantly, pin down what must NOT be blocked:
 * reads and teardown. An entitlement that traps a customer's data when it
 * lapses is worse than no entitlement.
 */

const suffix = `fe${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let entitledOrg: { id: string };
let barredOrg: { id: string };
let user: { id: string };
let entitledProperty: { id: string };
let barredProperty: { id: string };

function ctxFor(orgId: string, isPlatformAdmin = false): SessionContext {
  return {
    userId: user.id,
    userName: "FE User",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin,
    organizationId: orgId,
    organizationName: "FE Org",
    membershipId: "irrelevant",
    role: Role.OWNER,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

async function makeOrg(label: string) {
  const org = await prisma.organization.create({
    data: { name: `FE ${label} ${suffix}`, slug: `fe-${label}-${suffix}` },
  });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const property = await prisma.property.create({
    data: {
      organizationId: org.id, portfolioId: pf.id, name: `fe-${label}-${suffix}`,
      addressLine1: "1 Main St", city: "Testville", state: "TX", postalCode: "75001",
    },
  });
  return { org, property };
}

beforeAll(async () => {
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "FE" } });
  const a = await makeOrg("yes");
  const b = await makeOrg("no");
  entitledOrg = a.org;
  entitledProperty = a.property;
  barredOrg = b.org;
  barredProperty = b.property;

  // The flags must exist as platform definitions; the seed creates them in a
  // real deployment, but a test database may not have been seeded.
  for (const key of [FEATURE_FLAGS.MATTERPORT, FEATURE_FLAGS.DRONE_PROCESSING]) {
    await prisma.featureFlag.upsert({
      where: { key },
      create: { key, description: `${key} (test)`, defaultEnabled: true },
      update: {},
    });
  }
});

beforeEach(async () => {
  // Entitled org: no override, inherits the enabled default.
  await prisma.featureFlagOverride.deleteMany({ where: { organizationId: entitledOrg.id } });
  // Barred org: explicitly switched off, which is what "did not buy it" is.
  for (const key of [FEATURE_FLAGS.MATTERPORT, FEATURE_FLAGS.DRONE_PROCESSING]) {
    await prisma.featureFlagOverride.upsert({
      where: { flagKey_organizationId: { flagKey: key, organizationId: barredOrg.id } },
      create: { flagKey: key, organizationId: barredOrg.id, enabled: false },
      update: { enabled: false },
    });
  }
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: entitledOrg.id } });
  await prisma.organization.delete({ where: { id: barredOrg.id } });
  await prisma.user.delete({ where: { id: user.id } });
});

describe("feature entitlement", () => {
  it("a per-organization override beats the platform default", async () => {
    expect(await isFeatureEnabled(entitledOrg.id, FEATURE_FLAGS.DRONE_PROCESSING)).toBe(true);
    expect(await isFeatureEnabled(barredOrg.id, FEATURE_FLAGS.DRONE_PROCESSING)).toBe(false);
  });

  it("an unknown flag resolves to disabled, never to allowed", async () => {
    // A paid feature must not be given away because its definition row is
    // missing — from a failed migration, say.
    expect(await isFeatureEnabled(entitledOrg.id, "no_such_flag" as never)).toBe(false);
  });

  it("resolveFeatureFlags and isFeatureEnabled agree", async () => {
    // Two resolvers that can disagree would let the UI offer what the service
    // refuses. This is the only thing stopping that drift.
    for (const orgId of [entitledOrg.id, barredOrg.id]) {
      const all = await resolveFeatureFlags(orgId);
      for (const key of Object.values(FEATURE_FLAGS)) {
        if (!(key in all)) continue;
        expect(await isFeatureEnabled(orgId, key)).toBe(all[key]);
      }
    }
  });

  it("blocks drone capture creation for an organization without the flag", async () => {
    await expect(
      createDroneCapture(ctxFor(barredOrg.id), barredProperty.id, { droneModel: "test" }),
    ).rejects.toThrow(/not enabled for your organization/i);
  });

  it("allows drone capture creation for an entitled organization", async () => {
    const capture = await createDroneCapture(ctxFor(entitledOrg.id), entitledProperty.id, { droneModel: "test" });
    expect(capture.id).toBeTruthy();
    await prisma.droneCapture.delete({ where: { id: capture.id } });
  });

  it("blocks Matterport connect and linking for an organization without the flag", async () => {
    await expect(connectMatterportForOrg(ctxFor(barredOrg.id))).rejects.toThrow(/not enabled/i);
    await expect(
      linkSpaceByIdDirect(ctxFor(barredOrg.id), barredProperty.id, "someSpaceId"),
    ).rejects.toThrow(/not enabled/i);
  });

  it("does NOT block disconnecting — a lapsed entitlement must not trap data", async () => {
    // The real scenario: they linked a space while entitled, then the
    // entitlement lapsed. The rows are written directly because the linking
    // path is (correctly) gated.
    const connection = await prisma.matterportConnection.create({
      data: { organizationId: barredOrg.id, status: "VIEWER_ONLY" },
    });
    const space = await prisma.matterportSpace.create({
      data: { connectionId: connection.id, externalSpaceId: `sp-${suffix}`, status: "UNVERIFIED" },
    });
    await prisma.matterportPropertyLink.create({
      data: { propertyId: barredProperty.id, spaceId: space.id },
    });

    await expect(disconnectPropertyInterior(ctxFor(barredOrg.id), barredProperty.id)).resolves.not.toThrow();
    expect(await prisma.matterportPropertyLink.count({ where: { propertyId: barredProperty.id } })).toBe(0);
  });

  it("does not block reading interior status without the flag", async () => {
    // The UI has to be able to render "not enabled". Gating the read would
    // make the upsell invisible.
    const status = await getPropertyInteriorStatus(ctxFor(barredOrg.id), barredProperty.id);
    expect(status).toBeTruthy();
  });

  it("does not exempt platform admins", async () => {
    // Entitlement describes what the organization bought, not how powerful
    // the viewer is. Support staff inside a customer's account should see
    // exactly what that customer can do.
    await expect(
      createDroneCapture(ctxFor(barredOrg.id, true), barredProperty.id, { droneModel: "test" }),
    ).rejects.toThrow(/not enabled/i);
  });

  it("refuses with 403, not 404 or 500", async () => {
    // The status code is the difference between "you cannot buy this" and
    // "something broke". A 500 would send the customer to support instead of
    // to sales.
    await expect(requireFeature(ctxFor(barredOrg.id), FEATURE_FLAGS.MATTERPORT)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("names the feature in the denial so the user knows what to ask for", async () => {
    await expect(requireFeature(ctxFor(barredOrg.id), FEATURE_FLAGS.MATTERPORT)).rejects.toThrow(/Matterport/i);
    await expect(requireFeature(ctxFor(barredOrg.id), FEATURE_FLAGS.DRONE_PROCESSING)).rejects.toThrow(/Drone/i);
  });
});
