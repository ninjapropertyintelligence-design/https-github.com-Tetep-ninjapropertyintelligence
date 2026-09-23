import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import {
  createCaptureJob,
  getCaptureJob,
  issueCaptureJob,
  listCaptureJobs,
  outstandingDeliverables,
  reviewCaptureSite,
  submitCaptureSite,
  submitConditionScores,
} from "@/lib/capture-job-service";
import { createEvidenceBatch, MAX_EVIDENCE_BATCH } from "@/lib/evidence-service";
import { canAccessProperty } from "@/lib/tenant-scope";
import { computePropertyHealth } from "@/lib/scoring";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Capture jobs.
 *
 * The job is a work order AND an authorization AND a definition of done, and
 * each of those is a thing that fails silently if it is wrong: a vendor who
 * keeps access after the work, a site marked delivered with nothing behind
 * it, or a capture campaign that produces imagery and moves no number.
 */

const suffix = `cj${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let vendor: { id: string };
let staff: { id: string };
let vendorUser: { id: string };
let siteA: { id: string };
let siteB: { id: string };
let untouchedSite: { id: string };
let assetA: { id: string };
let assetOnOtherSite: { id: string };

function staffCtx(): SessionContext {
  return {
    userId: staff.id,
    userName: "CJ Staff",
    userEmail: `staff-${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "CJ Org",
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

/** A subcontractor: no access grants at all, only a vendor id. */
function vendorCtx(): SessionContext {
  return {
    ...staffCtx(),
    userId: vendorUser.id,
    userName: "CJ Vendor",
    role: Role.VENDOR,
    vendorId: vendor.id,
    grants: [],
  };
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `CJ ${suffix}`, slug: `cj-${suffix}` } });
  vendor = await prisma.vendor.create({
    data: { organizationId: org.id, name: `Capture Co ${suffix}`, trade: "Capture" },
  });
  staff = await prisma.user.create({
    data: { email: `staff-${suffix}@example.com`, passwordHash: "x", name: "Staff" },
  });
  vendorUser = await prisma.user.create({
    data: { email: `vendor-${suffix}@example.com`, passwordHash: "x", name: "Vendor" },
  });

  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const makeSite = (name: string) =>
    prisma.property.create({
      data: {
        organizationId: org.id,
        portfolioId: pf.id,
        name: `${name}-${suffix}`,
        addressLine1: "1 Main St",
        city: "Testville",
        state: "TX",
        postalCode: "75001",
      },
    });
  siteA = await makeSite("site-a");
  siteB = await makeSite("site-b");
  untouchedSite = await makeSite("untouched");

  assetA = await prisma.asset.create({
    data: {
      organizationId: org.id,
      propertyId: siteA.id,
      name: "RTU-01",
      assetType: "HVAC rooftop unit",
      conditionScore: 90,
      criticalityScore: 4,
    },
  });
  assetOnOtherSite = await prisma.asset.create({
    data: {
      organizationId: org.id,
      propertyId: untouchedSite.id,
      name: "RTU-99",
      assetType: "HVAC rooftop unit",
      conditionScore: 90,
    },
  });
});

beforeEach(async () => {
  await prisma.captureJob.deleteMany({ where: { organizationId: org.id } });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.delete({ where: { id: staff.id } });
  await prisma.user.delete({ where: { id: vendorUser.id } });
});

async function issuedJob(deliverables: Array<"DRONE" | "PHOTOS" | "CONDITION_SCORES" | "IMAGE_360"> = ["CONDITION_SCORES"]) {
  const job = await createCaptureJob(staffCtx(), {
    title: `Q3 sweep ${suffix}`,
    vendorId: vendor.id,
    propertyIds: [siteA.id, siteB.id],
    deliverables,
  });
  await issueCaptureJob(staffCtx(), job.id);
  return getCaptureJob(staffCtx(), job.id);
}

describe("the job as an authorization", () => {
  it("gives a vendor no property access before a job is issued", async () => {
    // A vendor has no access grants. Without an open job this must be nothing
    // at all — not "their organization's properties".
    expect(await canAccessProperty(vendorCtx(), siteA.id)).toBe(false);

    await createCaptureJob(staffCtx(), {
      title: "draft",
      vendorId: vendor.id,
      propertyIds: [siteA.id],
      deliverables: ["PHOTOS"],
    });
    // Still nothing: a job being assembled is not work the vendor has been sent.
    expect(await canAccessProperty(vendorCtx(), siteA.id)).toBe(false);
  });

  it("grants access to exactly the job's sites once issued", async () => {
    await issuedJob();
    expect(await canAccessProperty(vendorCtx(), siteA.id)).toBe(true);
    expect(await canAccessProperty(vendorCtx(), siteB.id)).toBe(true);
    // The neighbouring site is in the same organization and the same
    // portfolio, and must remain invisible.
    expect(await canAccessProperty(vendorCtx(), untouchedSite.id)).toBe(false);
  });

  it("ends access when the last site is accepted", async () => {
    const job = await issuedJob(["PHOTOS"]);
    for (const site of job.sites) {
      await prisma.evidence.create({
        data: {
          organizationId: org.id,
          propertyId: site.propertyId,
          type: "PHOTO",
          storageKey: `${site.propertyId}/${crypto.randomUUID()}-x.jpg`,
          uploadedById: vendorUser.id,
        },
      });
      await submitCaptureSite(vendorCtx(), job.id, site.id);
      await reviewCaptureSite(staffCtx(), job.id, site.id, { accept: true });
    }

    expect((await prisma.captureJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("ACCEPTED");
    // This is the property the whole design exists for: nobody had to
    // remember to revoke anything.
    expect(await canAccessProperty(vendorCtx(), siteA.id)).toBe(false);
  });

  it("hides a draft job from the vendor's list and refuses it by id", async () => {
    const job = await createCaptureJob(staffCtx(), {
      title: "draft",
      vendorId: vendor.id,
      propertyIds: [siteA.id],
      deliverables: ["PHOTOS"],
    });
    expect(await listCaptureJobs(vendorCtx())).toHaveLength(0);
    await expect(getCaptureJob(vendorCtx(), job.id)).rejects.toThrow(/not found/i);
    expect(await listCaptureJobs(staffCtx())).toHaveLength(1);
  });

  it("refuses to create a job over a property the creator cannot see", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: `CJ other ${suffix}`, slug: `cj-other-${suffix}` },
    });
    const otherPf = await prisma.portfolio.create({ data: { organizationId: otherOrg.id, name: "PF" } });
    const foreign = await prisma.property.create({
      data: {
        organizationId: otherOrg.id, portfolioId: otherPf.id, name: `foreign-${suffix}`,
        addressLine1: "9 Other St", city: "Elsewhere", state: "CA", postalCode: "90001",
      },
    });
    try {
      // A job is an access grant, so an unscoped id here would hand a
      // subcontractor a property its author cannot even see.
      await expect(
        createCaptureJob(staffCtx(), {
          title: "sneaky",
          vendorId: vendor.id,
          propertyIds: [siteA.id, foreign.id],
          deliverables: ["PHOTOS"],
        }),
      ).rejects.toThrow(/don't have access/i);
    } finally {
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });

  it("will not issue a job with no vendor assigned", async () => {
    // Issuing to nobody grants access to nobody while looking dispatched.
    const job = await createCaptureJob(staffCtx(), {
      title: "unassigned",
      propertyIds: [siteA.id],
      deliverables: ["PHOTOS"],
    });
    await expect(issueCaptureJob(staffCtx(), job.id)).rejects.toThrow(/assign a vendor/i);
  });

  it("does not let a vendor issue or review its own work", async () => {
    const job = await issuedJob(["PHOTOS"]);
    await expect(issueCaptureJob(vendorCtx(), job.id)).rejects.toThrow();
    await expect(
      reviewCaptureSite(vendorCtx(), job.id, job.sites[0].id, { accept: true }),
    ).rejects.toThrow(/cannot review its own/i);
  });
});

describe("definition of done", () => {
  it("refuses to submit a site that still owes deliverables, and names them", async () => {
    const job = await issuedJob(["PHOTOS", "CONDITION_SCORES"]);
    // "Incomplete" would send a subcontractor back to guess which of five
    // deliverables is short.
    await expect(submitCaptureSite(vendorCtx(), job.id, job.sites[0].id)).rejects.toThrow(/photos/i);
  });

  it("does not count work that predates the job", async () => {
    // Otherwise a job is satisfied on day one by the previous vendor's
    // imagery, and the subcontractor is paid for someone else's capture.
    await prisma.evidence.create({
      data: {
        organizationId: org.id,
        propertyId: siteA.id,
        type: "PHOTO",
        storageKey: `${siteA.id}/${crypto.randomUUID()}-old.jpg`,
        uploadedById: staff.id,
        createdAt: new Date(Date.now() - 86400000),
      },
    });
    const job = await issuedJob(["PHOTOS"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    const { missing } = await outstandingDeliverables(site.id);
    expect(missing).toContain("PHOTOS");
  });

  it("accepts the submission once the deliverable actually exists", async () => {
    const job = await issuedJob(["PHOTOS"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    await prisma.evidence.create({
      data: {
        organizationId: org.id,
        propertyId: siteA.id,
        type: "PHOTO",
        storageKey: `${siteA.id}/${crypto.randomUUID()}-new.jpg`,
        uploadedById: vendorUser.id,
      },
    });
    const submitted = await submitCaptureSite(vendorCtx(), job.id, site.id);
    expect(submitted.status).toBe("SUBMITTED");
  });

  it("requires a reason when a site is rejected", async () => {
    const job = await issuedJob(["PHOTOS"]);
    const site = job.sites[0];
    await prisma.evidence.create({
      data: {
        organizationId: org.id,
        propertyId: site.propertyId,
        type: "PHOTO",
        storageKey: `${site.propertyId}/${crypto.randomUUID()}-x.jpg`,
        uploadedById: vendorUser.id,
      },
    });
    await submitCaptureSite(vendorCtx(), job.id, site.id);
    // A rejection with no reason is a site the vendor resubmits unchanged.
    await expect(reviewCaptureSite(staffCtx(), job.id, site.id, { accept: false })).rejects.toThrow(/reason/i);
  });
});

describe("condition scores — the deliverable that moves the number", () => {
  it("changes the property's health score, not just its evidence count", async () => {
    // The whole commercial point: imagery alone never moves health, because
    // health is computed from asset condition.
    const before = await computePropertyHealth(siteA.id);

    const job = await issuedJob(["CONDITION_SCORES"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    await submitConditionScores(vendorCtx(), job.id, site.id, [
      { assetId: assetA.id, score: 35, reason: "Compressor corrosion, visible refrigerant staining" },
    ]);

    const after = await computePropertyHealth(siteA.id);
    expect(after.healthScore).toBeLessThan(before.healthScore);
    expect(after.categoryBreakdown.HVAC.score).toBe(35);
  });

  it("records who submitted it and against which job", async () => {
    const job = await issuedJob(["CONDITION_SCORES"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    await submitConditionScores(vendorCtx(), job.id, site.id, [{ assetId: assetA.id, score: 42 }]);

    const history = await prisma.assetConditionHistory.findFirst({
      where: { assetId: assetA.id },
      orderBy: { changedAt: "desc" },
    });
    // Provenance: a disputed score has to lead back to the visit.
    expect(history?.changedByUserId).toBe(vendorUser.id);
    expect(history?.reason).toContain(job.title);
  });

  it("refuses an asset that belongs to a different site", async () => {
    // A real asset id from another of the vendor's sites would otherwise
    // silently score the wrong building.
    const job = await issuedJob(["CONDITION_SCORES"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    await expect(
      submitConditionScores(vendorCtx(), job.id, site.id, [{ assetId: assetOnOtherSite.id, score: 10 }]),
    ).rejects.toThrow(/do not belong to this site/i);
  });

  it("satisfies the CONDITION_SCORES deliverable", async () => {
    const job = await issuedJob(["CONDITION_SCORES"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    await submitConditionScores(vendorCtx(), job.id, site.id, [{ assetId: assetA.id, score: 55 }]);
    expect((await outstandingDeliverables(site.id)).missing).toHaveLength(0);
    expect((await submitCaptureSite(vendorCtx(), job.id, site.id)).status).toBe("SUBMITTED");
  });

  it("stops accepting submissions once the site is accepted", async () => {
    const job = await issuedJob(["CONDITION_SCORES"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    await submitConditionScores(vendorCtx(), job.id, site.id, [{ assetId: assetA.id, score: 60 }]);
    await submitCaptureSite(vendorCtx(), job.id, site.id);
    await reviewCaptureSite(staffCtx(), job.id, site.id, { accept: true });

    await expect(
      submitConditionScores(vendorCtx(), job.id, site.id, [{ assetId: assetA.id, score: 99 }]),
    ).rejects.toThrow(/accepted/i);
  });
});

describe("bulk upload", () => {
  it("registers a whole flight in one call", async () => {
    const items = Array.from({ length: 120 }, () => ({
      type: "DRONE_IMAGE" as const,
      storageKey: `${siteA.id}/${crypto.randomUUID()}-DJI.jpg`,
      propertyId: siteA.id,
      mimeType: "image/jpeg",
      sizeBytes: 4_200_000,
    }));
    const result = await createEvidenceBatch(staffCtx(), items);
    expect(result.created).toBe(120);
    expect(result.ids).toHaveLength(120);
  });

  it("meters each panorama in a batch, not the batch", async () => {
    // Charging once per batch would let a customer avoid the meter by
    // uploading in bigger batches.
    await prisma.featureFlag.upsert({
      where: { key: "image_360" },
      create: { key: "image_360", description: "360 (test)", defaultEnabled: true },
      update: {},
    });
    await prisma.usageRecord.deleteMany({ where: { organizationId: org.id } });

    await createEvidenceBatch(
      staffCtx(),
      Array.from({ length: 5 }, () => ({
        type: "IMAGE_360" as const,
        storageKey: `${siteA.id}/${crypto.randomUUID()}-pano.jpg`,
        propertyId: siteA.id,
      })),
    );
    expect(
      await prisma.usageRecord.count({ where: { organizationId: org.id, metricType: "IMAGE_360_CAPTURE" } }),
    ).toBe(5);
  });

  it("rejects the whole batch when one file names a property the caller cannot reach", async () => {
    // Registering 400 files and failing on the 401st leaves the caller unable
    // to tell what landed.
    const before = await prisma.evidence.count({ where: { organizationId: org.id } });
    await expect(
      createEvidenceBatch(staffCtx(), [
        { type: "PHOTO", storageKey: `${siteA.id}/${crypto.randomUUID()}-ok.jpg`, propertyId: siteA.id },
        { type: "PHOTO", storageKey: `${siteA.id}/${crypto.randomUUID()}-bad.jpg`, propertyId: "nope" },
      ]),
    ).rejects.toThrow(/can't access/i);
    expect(await prisma.evidence.count({ where: { organizationId: org.id } })).toBe(before);
  });

  it("refuses a batch over the bind-parameter ceiling", async () => {
    await expect(
      createEvidenceBatch(
        staffCtx(),
        Array.from({ length: MAX_EVIDENCE_BATCH + 1 }, () => ({
          type: "PHOTO" as const,
          storageKey: `${siteA.id}/${crypto.randomUUID()}-x.jpg`,
          propertyId: siteA.id,
        })),
      ),
    ).rejects.toThrow(/at most/i);
  });

  it("lets a vendor bulk-upload to a site on their open job", async () => {
    const job = await issuedJob(["PHOTOS"]);
    const result = await createEvidenceBatch(vendorCtx(), [
      { type: "PHOTO", storageKey: `${siteA.id}/${crypto.randomUUID()}-v.jpg`, propertyId: siteA.id },
    ]);
    expect(result.created).toBe(1);
    void job;
  });

  it("does not let a vendor bulk-upload to a site not on their job", async () => {
    await issuedJob(["PHOTOS"]);
    await expect(
      createEvidenceBatch(vendorCtx(), [
        { type: "PHOTO", storageKey: `${untouchedSite.id}/${crypto.randomUUID()}-v.jpg`, propertyId: untouchedSite.id },
      ]),
    ).rejects.toThrow(/can't access/i);
  });
});
