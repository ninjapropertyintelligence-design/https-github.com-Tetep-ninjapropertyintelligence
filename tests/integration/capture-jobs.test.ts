import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import {
  createCaptureJob,
  getCaptureJob,
  issueCaptureJob,
  listCaptureJobs,
  outstandingDeliverables,
  outstandingShots,
  reviewCaptureSite,
  submitCaptureSite,
  submitConditionScores,
} from "@/lib/capture-job-service";
import { createEvidenceBatch, MAX_EVIDENCE_BATCH } from "@/lib/evidence-service";
import { resolveDroneTargetForSite } from "@/lib/capture-job-service";
import { MAX_DRONE_IMAGE_BATCH, registerDroneImagesBatch } from "@/lib/drone-service";
import { linkSpaceByIdDirect, normalizeSpaceId } from "@/lib/matterport-service";
import { getStorageProvider } from "@/lib/storage";
import { canAccessProperty, evidenceScopeWhere } from "@/lib/tenant-scope";
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

  // Real memberships, because notification delivery is resolved from them:
  // `notifyPropertyStakeholders` looks up org-wide roles and
  // `notifyVendorUsers` looks up the vendor's own. A context object alone
  // reaches nobody.
  await prisma.membership.create({
    data: { userId: staff.id, organizationId: org.id, role: Role.OWNER },
  });
  await prisma.membership.create({
    data: { userId: vendorUser.id, organizationId: org.id, role: Role.VENDOR, vendorId: vendor.id },
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
  await prisma.notification.deleteMany({ where: { organizationId: org.id } });
  // Drone captures too: `resolveDroneTargetForSite` deliberately REUSES an
  // in-flight capture, so without this each test inherits the previous
  // test's dataset and its images. That coupling made a batch assertion
  // count twelve rows a later test never wrote.
  await prisma.droneCapture.deleteMany({
    where: { propertyId: { in: [siteA.id, siteB.id, untouchedSite.id] } },
  });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.delete({ where: { id: staff.id } });
  await prisma.user.delete({ where: { id: vendorUser.id } });
});

async function issuedJob(
  deliverables: Array<"DRONE" | "PHOTOS" | "CONDITION_SCORES" | "IMAGE_360" | "MATTERPORT"> = ["CONDITION_SCORES"],
) {
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

  it("refuses a batch from a read-only viewer", async () => {
    const viewer: SessionContext = { ...staffCtx(), role: Role.VIEWER };
    await expect(
      createEvidenceBatch(viewer, [
        { type: "PHOTO", storageKey: `${siteA.id}/${crypto.randomUUID()}-v.jpg`, propertyId: siteA.id },
      ]),
    ).rejects.toMatchObject({ status: 403 });
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


describe("the upload panel's server side", () => {
  it("resolves a drone target the vendor never has to think about", async () => {
    const job = await issuedJob(["DRONE"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    const target = await resolveDroneTargetForSite(vendorCtx(), job.id, site.id);
    expect(target.captureId).toBeTruthy();
    expect(target.datasetId).toBeTruthy();
  });

  it("reuses an in-flight capture instead of creating one per upload", async () => {
    // A vendor uploading in three sittings would otherwise produce three
    // captures of the same flight, and the Exterior tab's date selector
    // fills with duplicates each holding a third of the photos.
    const job = await issuedJob(["DRONE"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    const first = await resolveDroneTargetForSite(vendorCtx(), job.id, site.id);
    const second = await resolveDroneTargetForSite(vendorCtx(), job.id, site.id);
    expect(second.captureId).toBe(first.captureId);
    expect(second.datasetId).toBe(first.datasetId);
    expect(await prisma.droneCapture.count({ where: { propertyId: siteA.id } })).toBe(1);
  });

  it("refuses a drone target once the job is closed", async () => {
    // Deliberately as STAFF, not as the vendor. A vendor's job lookup already
    // filters to open jobs, so a vendor would be refused even with this check
    // removed — the test would pass for the wrong reason and prove nothing.
    // Staff can see a cancelled job, so staff is the path where the status
    // check is the only thing standing there.
    const job = await issuedJob(["DRONE"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    await prisma.captureJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
    await expect(resolveDroneTargetForSite(staffCtx(), job.id, site.id)).rejects.toThrow(
      /no longer accepts uploads/i,
    );
  });

  it("registers a whole flight in one call", async () => {
    const job = await issuedJob(["DRONE"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    const { datasetId } = await resolveDroneTargetForSite(vendorCtx(), job.id, site.id);

    // The bytes go to storage first, because registration verifies that the
    // object actually exists — metadata for a file nobody uploaded is how a
    // dataset ends up full of rows pointing at nothing.
    const storage = getStorageProvider();
    const images = await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        const storageKey = `${siteA.id}/${crypto.randomUUID()}-DJI_${i}.jpg`;
        await storage.writeBytes(storageKey, Buffer.from(`fake-jpeg-${i}`));
        return { storageKey, mimeType: "image/jpeg" };
      }),
    );

    const result = await registerDroneImagesBatch(vendorCtx(), datasetId, images);
    expect(result.registered).toBe(12);
    expect(await prisma.droneImage.count({ where: { datasetId } })).toBe(12);
  });

  it("rejects the whole batch on an unsupported file, before writing anything", async () => {
    // Failing on image 300 would leave a half-registered dataset with no way
    // for the caller to tell which files landed.
    const job = await issuedJob(["DRONE"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    const { datasetId } = await resolveDroneTargetForSite(vendorCtx(), job.id, site.id);

    await expect(
      registerDroneImagesBatch(vendorCtx(), datasetId, [
        { storageKey: `${siteA.id}/${crypto.randomUUID()}-ok.jpg` },
        { storageKey: `${siteA.id}/${crypto.randomUUID()}-notes.pdf` },
      ]),
    ).rejects.toThrow(/unsupported image file type/i);
    expect(await prisma.droneImage.count({ where: { datasetId } })).toBe(0);
  });

  it("refuses a drone batch over the ceiling", async () => {
    const job = await issuedJob(["DRONE"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    const { datasetId } = await resolveDroneTargetForSite(vendorCtx(), job.id, site.id);
    await expect(
      registerDroneImagesBatch(
        vendorCtx(),
        datasetId,
        Array.from({ length: MAX_DRONE_IMAGE_BATCH + 1 }, () => ({
          storageKey: `${siteA.id}/${crypto.randomUUID()}-x.jpg`,
        })),
      ),
    ).rejects.toThrow(/at most/i);
  });

  it("does not let a vendor register images against another site's dataset", async () => {
    // The dataset id is a client-supplied value, so it is re-scoped.
    const job = await issuedJob(["DRONE"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    const { datasetId } = await resolveDroneTargetForSite(vendorCtx(), job.id, site.id);

    // Close the job, which ends the vendor's access to the site.
    for (const s2 of job.sites) {
      await prisma.captureJobSite.update({ where: { id: s2.id }, data: { status: "ACCEPTED" } });
    }
    await prisma.captureJob.update({ where: { id: job.id }, data: { status: "ACCEPTED" } });

    await expect(
      registerDroneImagesBatch(vendorCtx(), datasetId, [
        { storageKey: `${siteA.id}/${crypto.randomUUID()}-late.jpg` },
      ]),
    ).rejects.toThrow();
    void site;
  });
});


describe("reading evidence is scoped too", () => {
  it("does not let a vendor list a site they were never sent to", async () => {
    // The list endpoint takes propertyId from the query string, so naming a
    // site must not be enough to read it.
    await prisma.evidence.create({
      data: {
        organizationId: org.id,
        propertyId: untouchedSite.id,
        type: "PHOTO",
        storageKey: `${untouchedSite.id}/${crypto.randomUUID()}-private.jpg`,
        uploadedById: staff.id,
      },
    });
    await issuedJob(["PHOTOS"]);

    const visible = await prisma.evidence.findMany({
      where: { ...evidenceScopeWhere(vendorCtx()), propertyId: untouchedSite.id },
    });
    expect(visible).toHaveLength(0);

    // And the site they WERE sent to stays readable.
    await prisma.evidence.create({
      data: {
        organizationId: org.id,
        propertyId: siteA.id,
        type: "PHOTO",
        storageKey: `${siteA.id}/${crypto.randomUUID()}-theirs.jpg`,
        uploadedById: vendorUser.id,
      },
    });
    const own = await prisma.evidence.findMany({
      where: { ...evidenceScopeWhere(vendorCtx()), propertyId: siteA.id },
    });
    expect(own.length).toBeGreaterThan(0);
  });

  it("still shows an owner everything in the organization", async () => {
    const all = await prisma.evidence.findMany({ where: evidenceScopeWhere(staffCtx()) });
    expect(all.length).toBeGreaterThan(0);
  });
});


describe("the shot list", () => {
  async function jobWithRoute() {
    const job = await createCaptureJob(staffCtx(), {
      title: `Routed ${suffix}`,
      vendorId: vendor.id,
      propertyIds: [siteA.id, siteB.id],
      deliverables: ["IMAGE_360"],
      shots: [
        { label: "North lot" },
        { label: "Main entrance" },
        { label: "Roof — RTU row", kind: "PHOTO", required: false },
      ],
    });
    await issueCaptureJob(staffCtx(), job.id);
    return getCaptureJob(staffCtx(), job.id);
  }

  it("applies the same route to every site, in walking order", async () => {
    // Identical naming across sites is the whole point: it is what lets this
    // year's "North lot" be compared with last year's.
    const job = await jobWithRoute();
    expect(job.sites).toHaveLength(2);
    for (const site of job.sites) {
      expect(site.shots.map((s) => s.label)).toEqual(["North lot", "Main entrance", "Roof — RTU row"]);
      // A route is not alphabetical — the order it was given is the order it
      // is walked.
      expect(site.shots.map((s) => s.sequence)).toEqual([1, 2, 3]);
    }
  });

  it("counts a position as captured only when evidence is attached to it", async () => {
    const job = await jobWithRoute();
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    const northLot = site.shots.find((s) => s.label === "North lot")!;

    expect((await outstandingShots(site.id)).map((s) => s.label)).toEqual(["North lot", "Main entrance"]);

    // Evidence on the property but NOT on the position must not satisfy it:
    // otherwise any photo anywhere ticks off the whole route.
    await createEvidenceBatch(vendorCtx(), [
      { type: "IMAGE_360", storageKey: `${siteA.id}/${crypto.randomUUID()}-loose.jpg`, propertyId: siteA.id },
    ]);
    expect((await outstandingShots(site.id)).map((s) => s.label)).toEqual(["North lot", "Main entrance"]);

    await createEvidenceBatch(vendorCtx(), [
      {
        type: "IMAGE_360",
        storageKey: `${siteA.id}/${crypto.randomUUID()}-north.jpg`,
        propertyId: siteA.id,
        captureShotId: northLot.id,
      },
    ]);
    expect((await outstandingShots(site.id)).map((s) => s.label)).toEqual(["Main entrance"]);
  });

  it("ignores optional positions when deciding what is outstanding", async () => {
    const job = await jobWithRoute();
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    expect((await outstandingShots(site.id)).map((s) => s.label)).not.toContain("Roof — RTU row");
  });

  it("refuses to submit a site with an uncaptured position, and names it", async () => {
    // A site can hold every deliverable and still be missing half its route —
    // invisible until someone tries to compare this visit with the last one.
    const job = await jobWithRoute();
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    await createEvidenceBatch(vendorCtx(), [
      { type: "IMAGE_360", storageKey: `${siteA.id}/${crypto.randomUUID()}-any.jpg`, propertyId: siteA.id },
    ]);
    // The IMAGE_360 deliverable is now satisfied, so only the route is short.
    expect((await outstandingDeliverables(site.id)).missing).toHaveLength(0);
    await expect(submitCaptureSite(vendorCtx(), job.id, site.id)).rejects.toThrow(/North lot/);
  });

  it("accepts the submission once every required position is captured", async () => {
    const job = await jobWithRoute();
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    for (const shot of site.shots.filter((s) => s.required)) {
      await createEvidenceBatch(vendorCtx(), [
        {
          type: "IMAGE_360",
          storageKey: `${siteA.id}/${crypto.randomUUID()}-${shot.sequence}.jpg`,
          propertyId: siteA.id,
          captureShotId: shot.id,
        },
      ]);
    }
    expect((await submitCaptureSite(vendorCtx(), job.id, site.id)).status).toBe("SUBMITTED");
  });

  it("refuses a shot position belonging to a different site", async () => {
    // A real shot id from the vendor's OTHER site would otherwise mark that
    // site's route complete with imagery from somewhere else entirely.
    const job = await jobWithRoute();
    const siteARow = job.sites.find((s) => s.propertyId === siteA.id)!;
    const siteBRow = job.sites.find((s) => s.propertyId === siteB.id)!;
    await expect(
      createEvidenceBatch(vendorCtx(), [
        {
          type: "IMAGE_360",
          storageKey: `${siteA.id}/${crypto.randomUUID()}-wrong.jpg`,
          propertyId: siteA.id,
          captureShotId: siteBRow.shots[0].id,
        },
      ]),
    ).rejects.toThrow(/does not belong to this site/i);
    expect((await outstandingShots(siteBRow.id)).length).toBeGreaterThan(0);
    void siteARow;
  });

  it("leaves a job with no route behaving exactly as before", async () => {
    const job = await issuedJob(["PHOTOS"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    expect(await outstandingShots(site.id)).toHaveLength(0);
    await createEvidenceBatch(vendorCtx(), [
      { type: "PHOTO", storageKey: `${siteA.id}/${crypto.randomUUID()}-x.jpg`, propertyId: siteA.id },
    ]);
    expect((await submitCaptureSite(vendorCtx(), job.id, site.id)).status).toBe("SUBMITTED");
  });
});


describe("linking a Matterport space from the job", () => {
  beforeEach(async () => {
    // The flag has to exist as a platform definition; a test database may
    // never have been seeded.
    await prisma.featureFlag.upsert({
      where: { key: "matterport" },
      create: { key: "matterport", description: "matterport (test)", defaultEnabled: true },
      update: {},
    });
    await prisma.matterportConnection.deleteMany({ where: { organizationId: org.id } });
  });

  it("lets a vendor link a space on a site they were sent to", async () => {
    // Matterport is not an upload — the scan lives on Matterport's cloud and
    // what this product holds is a link. The vendor still has to be able to
    // hand it over from the job.
    const job = await issuedJob(["MATTERPORT"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;

    expect((await outstandingDeliverables(site.id)).missing).toContain("MATTERPORT");
    await linkSpaceByIdDirect(vendorCtx(), siteA.id, `sp-${suffix}`, "Store interior");
    expect((await outstandingDeliverables(site.id)).missing).not.toContain("MATTERPORT");
  });

  it("stores the space id when the vendor pastes a full Showcase URL", async () => {
    // What a vendor has in front of them is the URL, not the handle buried
    // inside it. Pasting the URL must not create a space whose id is the
    // whole link — the viewer would then never load and nothing would say why.
    const job = await issuedJob(["MATTERPORT"]);
    const site = job.sites.find((s) => s.propertyId === siteA.id)!;
    const spaceId = `Url${suffix.replace(/[^A-Za-z0-9]/g, "")}`;

    const link = await linkSpaceByIdDirect(
      vendorCtx(),
      siteA.id,
      `https://my.matterport.com/show/?m=${spaceId}&play=1`,
    );
    expect(link.space.externalSpaceId).toBe(spaceId);
    expect((await outstandingDeliverables(site.id)).missing).not.toContain("MATTERPORT");
  });

  it("normalises a bare id unchanged", () => {
    expect(normalizeSpaceId("  AbC123xyz  ")).toBe("AbC123xyz");
    expect(normalizeSpaceId("https://my.matterport.com/show/?m=AbC123xyz")).toBe("AbC123xyz");
  });

  it("does not let a vendor link a space to a site not on their job", async () => {
    await issuedJob(["MATTERPORT"]);
    await expect(
      linkSpaceByIdDirect(vendorCtx(), untouchedSite.id, `sp-bad-${suffix}`),
    ).rejects.toThrow();
  });

  it("does not let a vendor link once the job is closed", async () => {
    const job = await issuedJob(["MATTERPORT"]);
    for (const s2 of job.sites) {
      await prisma.captureJobSite.update({ where: { id: s2.id }, data: { status: "ACCEPTED" } });
    }
    await prisma.captureJob.update({ where: { id: job.id }, data: { status: "ACCEPTED" } });
    await expect(linkSpaceByIdDirect(vendorCtx(), siteA.id, `sp-late-${suffix}`)).rejects.toThrow();
  });
});

describe("telling people", () => {
  /** Satisfies a PHOTOS deliverable so the site can actually be submitted. */
  async function deliverPhotos(propertyId: string) {
    await prisma.evidence.create({
      data: {
        organizationId: org.id,
        propertyId,
        type: "PHOTO",
        storageKey: `${propertyId}/${crypto.randomUUID()}-x.jpg`,
        uploadedById: vendorUser.id,
      },
    });
  }

  it("tells the ordering organization when a vendor submits a site", async () => {
    const job = await issuedJob(["PHOTOS"]);
    const site = job.sites[0];
    await deliverPhotos(site.propertyId);
    await submitCaptureSite(vendorCtx(), job.id, site.id);

    const notes = await prisma.notification.findMany({ where: { organizationId: org.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(staff.id);
    expect(notes[0].type).toBe("CAPTURE_SUBMITTED");
    // The site has to be named. "A capture was submitted" across a 40-site
    // sweep tells a reviewer nothing about where to go.
    expect(notes[0].title).toContain(site.property.name);
    expect(notes[0].link).toBe(`/capture-jobs/${job.id}`);
    // And it must NOT go back to the vendor who just pressed submit.
    expect(notes.some((n) => n.userId === vendorUser.id)).toBe(false);
  });

  it("carries the rejection reason to the vendor, not just the fact of it", async () => {
    const job = await issuedJob(["PHOTOS"]);
    const site = job.sites[0];
    await deliverPhotos(site.propertyId);
    await submitCaptureSite(vendorCtx(), job.id, site.id);
    await prisma.notification.deleteMany({ where: { organizationId: org.id } });

    await reviewCaptureSite(staffCtx(), job.id, site.id, {
      accept: false,
      reason: "North elevation is out of focus — reshoot it.",
    });

    const notes = await prisma.notification.findMany({ where: { organizationId: org.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(vendorUser.id);
    expect(notes[0].type).toBe("CAPTURE_REJECTED");
    // The reason IS the instruction. A notification that says only
    // "returned" sends the vendor back to the job page to hunt for why.
    expect(notes[0].body).toContain("out of focus");
    expect(notes[0].link).toBe(`/capture-jobs/${job.id}`);
  });

  it("does not link a vendor to a job that closing has just hidden from them", async () => {
    const job = await issuedJob(["PHOTOS"]);
    for (const site of job.sites) {
      await deliverPhotos(site.propertyId);
      await submitCaptureSite(vendorCtx(), job.id, site.id);
      await reviewCaptureSite(staffCtx(), job.id, site.id, { accept: true });
    }

    const accepted = await prisma.notification.findMany({
      where: { organizationId: org.id, type: "CAPTURE_ACCEPTED" },
      orderBy: { createdAt: "asc" },
    });
    expect(accepted).toHaveLength(job.sites.length);

    // The last one closes the job, and a closed job is refused by
    // `getCaptureJob` for a vendor — so linking there would land them on a
    // 404 at the moment they are told the work is finished.
    const last = accepted[accepted.length - 1];
    expect(last.link).toBe("/capture-jobs");
    expect(last.body).toMatch(/closed/i);
    expect(await getCaptureJob(vendorCtx(), job.id).then(() => true, () => false)).toBe(false);

    // The earlier ones still point at a job the vendor can open.
    expect(accepted[0].link).toBe(`/capture-jobs/${job.id}`);
  });

  it("does not leak a review decision to a different vendor in the same organization", async () => {
    const otherVendor = await prisma.vendor.create({
      data: { organizationId: org.id, name: `Other Co ${suffix}`, trade: "Capture" },
    });
    const otherUser = await prisma.user.create({
      data: { email: `other-${suffix}@example.com`, passwordHash: "x", name: "Other" },
    });
    await prisma.membership.create({
      data: { userId: otherUser.id, organizationId: org.id, role: Role.VENDOR, vendorId: otherVendor.id },
    });

    try {
      const job = await issuedJob(["PHOTOS"]);
      const site = job.sites[0];
      await deliverPhotos(site.propertyId);
      await submitCaptureSite(vendorCtx(), job.id, site.id);
      await reviewCaptureSite(staffCtx(), job.id, site.id, { accept: true });

      const theirs = await prisma.notification.findMany({ where: { userId: otherUser.id } });
      expect(theirs).toHaveLength(0);
      const ours = await prisma.notification.findMany({
        where: { userId: vendorUser.id, type: "CAPTURE_ACCEPTED" },
      });
      expect(ours).toHaveLength(1);
    } finally {
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
  });

  it("does not undo a submission when notifying fails", async () => {
    const job = await issuedJob(["PHOTOS"]);
    const site = job.sites[0];
    await deliverPhotos(site.propertyId);

    // A property row the notification lookup cannot resolve is the closest
    // honest stand-in for the delivery layer being down. The submission is
    // the thing of record; a failed notification must not roll it back.
    const original = prisma.notification.createMany;
    (prisma as unknown as { notification: { createMany: unknown } }).notification.createMany = () => {
      throw new Error("notification store unavailable");
    };
    try {
      await submitCaptureSite(vendorCtx(), job.id, site.id);
    } finally {
      (prisma as unknown as { notification: { createMany: unknown } }).notification.createMany = original;
    }

    const after = await prisma.captureJobSite.findUniqueOrThrow({ where: { id: site.id } });
    expect(after.status).toBe("SUBMITTED");
  });
});
