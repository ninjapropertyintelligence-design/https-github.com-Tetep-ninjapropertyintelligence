import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { createEvidence } from "@/lib/evidence-service";
import { getProperty360Data } from "@/lib/image-360-service";
import { getSiteMapData } from "@/lib/site-map";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * 360 panorama capture — the third sellable capture kind.
 *
 * Three things have to hold and none of them is obvious from reading the
 * code: capture is gated by the flag while *viewing* is not, a panorama is
 * metered once per image and an ordinary photo is not metered at all, and the
 * Site Map counts panoramas as their own layer rather than folding them into
 * the generic evidence count.
 */

const suffix = `p360${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let entitledOrg: { id: string };
let barredOrg: { id: string };
let user: { id: string };
let entitledProperty: { id: string };
let barredProperty: { id: string };

function ctxFor(orgId: string): SessionContext {
  return {
    userId: user.id,
    userName: "P360 User",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: orgId,
    organizationName: "P360 Org",
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
    data: { name: `P360 ${label} ${suffix}`, slug: `p360-${label}-${suffix}` },
  });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const property = await prisma.property.create({
    data: {
      organizationId: org.id,
      portfolioId: pf.id,
      name: `p360-${label}-${suffix}`,
      addressLine1: "1 Main St",
      city: "Testville",
      state: "TX",
      postalCode: "75001",
      latitude: 32.7767,
      longitude: -96.797,
    },
  });
  return { org, property };
}

beforeAll(async () => {
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "P360" } });
  const a = await makeOrg("yes");
  const b = await makeOrg("no");
  entitledOrg = a.org;
  entitledProperty = a.property;
  barredOrg = b.org;
  barredProperty = b.property;

  await prisma.featureFlag.upsert({
    where: { key: FEATURE_FLAGS.IMAGE_360 },
    create: { key: FEATURE_FLAGS.IMAGE_360, description: "360 (test)", defaultEnabled: true },
    update: {},
  });
});

beforeEach(async () => {
  await prisma.featureFlagOverride.deleteMany({ where: { organizationId: entitledOrg.id } });
  await prisma.featureFlagOverride.upsert({
    where: { flagKey_organizationId: { flagKey: FEATURE_FLAGS.IMAGE_360, organizationId: barredOrg.id } },
    create: { flagKey: FEATURE_FLAGS.IMAGE_360, organizationId: barredOrg.id, enabled: false },
    update: { enabled: false },
  });
  await prisma.usageRecord.deleteMany({ where: { organizationId: { in: [entitledOrg.id, barredOrg.id] } } });
  await prisma.evidence.deleteMany({ where: { organizationId: { in: [entitledOrg.id, barredOrg.id] } } });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: entitledOrg.id } });
  await prisma.organization.delete({ where: { id: barredOrg.id } });
  await prisma.user.delete({ where: { id: user.id } });
});

/**
 * Same org and property, a different role.
 *
 * Scoped roles (Facilities Manager, Inspector, Technician, Vendor) reach
 * nothing without an explicit grant, so one is attached here. Without it
 * these tests fail on scope and would never reach the permission check they
 * exist to exercise — which is exactly what happened on the first run.
 */
function asRole(base: SessionContext, role: Role, propertyId?: string): SessionContext {
  return {
    ...base,
    role,
    grants: propertyId ? [{ scopeType: "PROPERTY", portfolioId: null, regionId: null, propertyId }] : [],
  };
}

function panoramaInput(propertyId: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    type: "IMAGE_360" as const,
    storageKey: `${propertyId}/${crypto.randomUUID()}-${name}`,
    mimeType: "image/jpeg",
    sizeBytes: 81885,
    propertyId,
    ...extra,
  };
}

describe("360 panorama capture", () => {
  it("blocks capture for an organization without the flag", async () => {
    await expect(
      createEvidence(ctxFor(barredOrg.id), panoramaInput(barredProperty.id, "lot.jpg")),
    ).rejects.toThrow(/not enabled for your organization/i);
    expect(await prisma.evidence.count({ where: { organizationId: barredOrg.id } })).toBe(0);
  });

  it("names 360 in the denial, and refuses with 403", async () => {
    await expect(
      createEvidence(ctxFor(barredOrg.id), panoramaInput(barredProperty.id, "lot.jpg")),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createEvidence(ctxFor(barredOrg.id), panoramaInput(barredProperty.id, "lot.jpg")),
    ).rejects.toThrow(/360/);
  });

  it("refuses on the entitlement before it complains about the property", async () => {
    // Order matters for the message the customer sees. Validating the
    // property first would tell an unentitled org that its own property is
    // invalid, which sends them to support instead of to sales.
    await expect(
      createEvidence(ctxFor(barredOrg.id), panoramaInput("no-such-property", "lot.jpg")),
    ).rejects.toThrow(/not enabled for your organization/i);
  });

  it("does NOT gate ordinary photos on the 360 flag", async () => {
    // The floor of the product is attaching a picture to an issue. Gating
    // that on a capture add-on would break the base plan.
    const photo = await createEvidence(ctxFor(barredOrg.id), {
      type: "PHOTO",
      storageKey: `${barredProperty.id}/${crypto.randomUUID()}-defect.jpg`,
      propertyId: barredProperty.id,
    });
    expect(photo.id).toBeTruthy();
  });

  it("meters one IMAGE_360_CAPTURE per panorama, attributed to the property", async () => {
    await createEvidence(ctxFor(entitledOrg.id), panoramaInput(entitledProperty.id, "north.jpg"));
    await createEvidence(ctxFor(entitledOrg.id), panoramaInput(entitledProperty.id, "south.jpg"));

    const usage = await prisma.usageRecord.findMany({
      where: { organizationId: entitledOrg.id, metricType: "IMAGE_360_CAPTURE" },
    });
    expect(usage).toHaveLength(2);
    // Per image, not per byte: the bytes are already metered as GB-months, and
    // counting them here too would bill the same object twice.
    expect(usage.map((u) => u.quantity)).toEqual([1, 1]);
    expect(usage.every((u) => u.propertyId === entitledProperty.id)).toBe(true);
  });

  it("refuses a read-only viewer, who otherwise passes every scope check", async () => {
    // VIEWER is an org-wide role, so tenant scope alone lets it reach every
    // property in the organization. These routes used to have no permission
    // check at all, which made the read-only role a writer everywhere.
    const viewer = asRole(ctxFor(entitledOrg.id), Role.VIEWER);
    await expect(
      createEvidence(viewer, {
        type: "PHOTO",
        storageKey: `${entitledProperty.id}/${crypto.randomUUID()}-v.jpg`,
        propertyId: entitledProperty.id,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await prisma.evidence.count({ where: { organizationId: entitledOrg.id } })).toBe(0);
  });

  it("still lets a facilities manager attach a photo", async () => {
    // The workflow that `canPerformCapture` would have broken. Attaching a
    // picture to an issue is the floor of the product, and a facilities
    // manager does not hold a capture permission.
    const fm = asRole(ctxFor(entitledOrg.id), Role.FACILITIES_MANAGER, entitledProperty.id);
    const photo = await createEvidence(fm, {
      type: "PHOTO",
      storageKey: `${entitledProperty.id}/${crypto.randomUUID()}-fm.jpg`,
      propertyId: entitledProperty.id,
    });
    expect(photo.id).toBeTruthy();
  });

  it("does not let a facilities manager register a 360 panorama", async () => {
    // A capture kind is sellable work, not an attachment, so it needs the
    // capture permission on top of the write permission.
    const fm = asRole(ctxFor(entitledOrg.id), Role.FACILITIES_MANAGER, entitledProperty.id);
    await expect(
      createEvidence(fm, panoramaInput(entitledProperty.id, "north.jpg")),
    ).rejects.toThrow(/canPerformCapture/);
  });

  it("lets an inspector register a 360 panorama", async () => {
    const inspector = asRole(ctxFor(entitledOrg.id), Role.INSPECTOR, entitledProperty.id);
    const panorama = await createEvidence(inspector, panoramaInput(entitledProperty.id, "north.jpg"));
    expect(panorama.id).toBeTruthy();
  });

  it("does not meter an ordinary photo as a 360 capture", async () => {
    await createEvidence(ctxFor(entitledOrg.id), {
      type: "PHOTO",
      storageKey: `${entitledProperty.id}/${crypto.randomUUID()}-defect.jpg`,
      propertyId: entitledProperty.id,
    });
    expect(
      await prisma.usageRecord.count({ where: { organizationId: entitledOrg.id, metricType: "IMAGE_360_CAPTURE" } }),
    ).toBe(0);
  });
});

describe("reading 360 panoramas", () => {
  it("returns only panoramas, never other evidence on the same property", async () => {
    await createEvidence(ctxFor(entitledOrg.id), panoramaInput(entitledProperty.id, "north.jpg"));
    await createEvidence(ctxFor(entitledOrg.id), {
      type: "PHOTO",
      storageKey: `${entitledProperty.id}/${crypto.randomUUID()}-defect.jpg`,
      propertyId: entitledProperty.id,
    });

    const { panoramas } = await getProperty360Data(ctxFor(entitledOrg.id), entitledProperty.id);
    expect(panoramas).toHaveLength(1);
    expect(panoramas[0].label).toBe("north.jpg");
    expect(panoramas[0].imageUrl).toBeTruthy();
  });

  it("serves panoramas from this origin, not from a presigned storage URL", async () => {
    // This is not a style preference. WebGL refuses to build a texture from a
    // cross-origin image with no CORS headers, and the object store's
    // presigned responses carry none — so a presigned URL here renders in an
    // <img> and fails in the viewer, which is exactly how it shipped broken
    // the first time.
    const panorama = await createEvidence(ctxFor(entitledOrg.id), panoramaInput(entitledProperty.id, "north.jpg"));
    const { panoramas } = await getProperty360Data(ctxFor(entitledOrg.id), entitledProperty.id);
    expect(panoramas[0].imageUrl).toBe(`/api/v1/evidence/${panorama.id}/content`);
    expect(panoramas[0].imageUrl).not.toMatch(/^https?:\/\//);
  });

  it("orders by capture date, newest first, with undated panoramas last", async () => {
    // Two separate traps, so these are uploaded in an order that trips both.
    //
    // Ordering by createdAt would report the upload order rather than the
    // shoot order: "old.jpg" is registered AFTER "new.jpg" here, the way a
    // backfilled shoot is, and must still sort second.
    //
    // And NULL sorts first in Postgres by default, which would present a
    // panorama whose camera recorded no date as the most recent view of the
    // site — so the undated one is uploaded last and must still sort last.
    await createEvidence(
      ctxFor(entitledOrg.id),
      panoramaInput(entitledProperty.id, "new.jpg", { captureDate: new Date("2026-03-01T00:00:00Z") }),
    );
    await createEvidence(
      ctxFor(entitledOrg.id),
      panoramaInput(entitledProperty.id, "old.jpg", { captureDate: new Date("2024-03-01T00:00:00Z") }),
    );
    await createEvidence(
      ctxFor(entitledOrg.id),
      panoramaInput(entitledProperty.id, "undated.jpg", { captureDate: null }),
    );

    const { panoramas } = await getProperty360Data(ctxFor(entitledOrg.id), entitledProperty.id);
    expect(panoramas.map((p) => p.label)).toEqual(["new.jpg", "old.jpg", "undated.jpg"]);
  });

  it("still shows panoramas captured before the entitlement lapsed", async () => {
    // Written directly because the capture path is (correctly) gated. This is
    // the real scenario: they shot them while entitled, then the plan lapsed.
    await prisma.evidence.create({
      data: {
        organizationId: barredOrg.id,
        propertyId: barredProperty.id,
        type: "IMAGE_360",
        storageKey: `${barredProperty.id}/${crypto.randomUUID()}-paid-for.jpg`,
        uploadedById: user.id,
      },
    });

    const data = await getProperty360Data(ctxFor(barredOrg.id), barredProperty.id);
    expect(data.enabled).toBe(false);
    expect(data.panoramas).toHaveLength(1);
  });

  it("reports the entitlement so the tab can show the upsell", async () => {
    expect((await getProperty360Data(ctxFor(entitledOrg.id), entitledProperty.id)).enabled).toBe(true);
  });

  it("refuses a property in another organization", async () => {
    await expect(getProperty360Data(ctxFor(barredOrg.id), entitledProperty.id)).rejects.toThrow(/not found/i);
  });

  it("falls back to a generic label when the key is not in the upload form", async () => {
    await prisma.evidence.create({
      data: {
        organizationId: entitledOrg.id,
        propertyId: entitledProperty.id,
        type: "IMAGE_360",
        storageKey: "legacy-key-with-no-uuid",
        uploadedById: user.id,
      },
    });
    const { panoramas } = await getProperty360Data(ctxFor(entitledOrg.id), entitledProperty.id);
    // Not a slice of the key presented as a filename.
    expect(panoramas[0].label).toBe("360 panorama 1");
  });
});

describe("360 panoramas on the Site Map", () => {
  it("counts panoramas as their own layer, not as evidence photos", async () => {
    await createEvidence(
      ctxFor(entitledOrg.id),
      panoramaInput(entitledProperty.id, "north.jpg", { latitude: 32.7768, longitude: -96.7971 }),
    );
    await createEvidence(ctxFor(entitledOrg.id), {
      type: "PHOTO",
      storageKey: `${entitledProperty.id}/${crypto.randomUUID()}-defect.jpg`,
      propertyId: entitledProperty.id,
      latitude: 32.7769,
      longitude: -96.7972,
    });

    const { layers } = await getSiteMapData(ctxFor(entitledOrg.id), entitledProperty.id);
    const panoramaLayer = layers.find((l) => l.key === "360-images");
    const evidenceLayer = layers.find((l) => l.key === "evidence-photos");

    expect(panoramaLayer?.count).toBe(1);
    // The panorama must not be counted twice, once in each layer.
    expect(evidenceLayer?.count).toBe(1);
    expect(panoramaLayer?.mapped).toBe(true);
    expect(panoramaLayer?.markers).toHaveLength(1);
    expect(panoramaLayer?.href).toContain("tab=360");
  });

  it("reports the layer as unmapped when no panorama is geotagged", async () => {
    // A toggle that visibly does nothing is worse than a plain count.
    await createEvidence(ctxFor(entitledOrg.id), panoramaInput(entitledProperty.id, "north.jpg"));
    const { layers } = await getSiteMapData(ctxFor(entitledOrg.id), entitledProperty.id);
    const panoramaLayer = layers.find((l) => l.key === "360-images");
    expect(panoramaLayer?.count).toBe(1);
    expect(panoramaLayer?.mapped).toBe(false);
    expect(panoramaLayer?.markers).toHaveLength(0);
  });

  it("includes panoramas in the media total", async () => {
    const before = (await getSiteMapData(ctxFor(entitledOrg.id), entitledProperty.id)).totalMedia;
    await createEvidence(ctxFor(entitledOrg.id), panoramaInput(entitledProperty.id, "north.jpg"));
    const after = (await getSiteMapData(ctxFor(entitledOrg.id), entitledProperty.id)).totalMedia;
    expect(after).toBe(before + 1);
  });
});
