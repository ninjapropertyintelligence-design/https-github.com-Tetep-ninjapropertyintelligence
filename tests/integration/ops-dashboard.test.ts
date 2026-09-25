import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import {
  createCaptureJob,
  issueCaptureJob,
  reviewCaptureSite,
  submitCaptureSite,
} from "@/lib/capture-job-service";
import { getOperationsDashboard } from "@/lib/ops-dashboard";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * The operations dashboard.
 *
 * Three things here fail quietly if they are wrong: a crew's derived location
 * (a dispatcher phones the wrong site), the scoping (a Facilities Manager sees
 * jobs on buildings they have no access to), and the roster's "available"
 * flag (work gets assigned to somebody already out).
 */

const suffix = `ops${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let staff: { id: string };
let vendorUser: { id: string };
let busyVendor: { id: string };
let idleVendor: { id: string };
let siteA: { id: string };
let siteB: { id: string };
let unscopedSite: { id: string };
let membership: { id: string };

function staffCtx(): SessionContext {
  return {
    userId: staff.id,
    userName: "Ops Staff",
    userEmail: `ops-${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Ops Org",
    membershipId: membership.id,
    role: Role.PORTFOLIO_ADMIN,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

/** A Facilities Manager granted one site only. */
function scopedCtx(propertyId: string): SessionContext {
  return {
    ...staffCtx(),
    role: Role.FACILITIES_MANAGER,
    grants: [{ scopeType: "PROPERTY", portfolioId: null, regionId: null, propertyId }],
  };
}

function vendorCtx(): SessionContext {
  return { ...staffCtx(), userId: vendorUser.id, role: Role.VENDOR, vendorId: busyVendor.id, grants: [] };
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `Ops ${suffix}`, slug: `ops-${suffix}` } });
  staff = await prisma.user.create({
    data: { email: `ops-${suffix}@example.com`, passwordHash: "x", name: "Staff" },
  });
  vendorUser = await prisma.user.create({
    data: { email: `opsvendor-${suffix}@example.com`, passwordHash: "x", name: "Vendor" },
  });
  membership = await prisma.membership.create({
    data: { userId: staff.id, organizationId: org.id, role: Role.PORTFOLIO_ADMIN },
  });
  busyVendor = await prisma.vendor.create({
    data: { organizationId: org.id, name: `Busy Capture ${suffix}`, trade: "Capture", contactEmail: "busy@example.com" },
  });
  idleVendor = await prisma.vendor.create({
    data: { organizationId: org.id, name: `Idle Capture ${suffix}`, trade: "Capture" },
  });
  await prisma.membership.create({
    data: { userId: vendorUser.id, organizationId: org.id, role: Role.VENDOR, vendorId: busyVendor.id },
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
  siteA = await makeSite("ops-site-a");
  siteB = await makeSite("ops-site-b");
  unscopedSite = await makeSite("ops-unscoped");
});

beforeEach(async () => {
  await prisma.captureJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.evidence.deleteMany({ where: { organizationId: org.id } });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.delete({ where: { id: staff.id } });
  await prisma.user.delete({ where: { id: vendorUser.id } });
});

async function issuedJob(propertyIds: string[], shots?: Array<{ label: string }>) {
  const job = await createCaptureJob(staffCtx(), {
    title: `Sweep ${suffix}`,
    vendorId: busyVendor.id,
    propertyIds,
    deliverables: ["PHOTOS"],
    shots,
  });
  await issueCaptureJob(staffCtx(), job.id);
  return job;
}

async function uploadPhoto(propertyId: string, captureShotId?: string) {
  return prisma.evidence.create({
    data: {
      organizationId: org.id,
      propertyId,
      type: "PHOTO",
      storageKey: `${propertyId}/${crypto.randomUUID()}-x.jpg`,
      uploadedById: vendorUser.id,
      captureShotId: captureShotId ?? null,
    },
  });
}

describe("what is running", () => {
  it("counts open jobs and leaves drafts out of them", async () => {
    await issuedJob([siteA.id]);
    await createCaptureJob(staffCtx(), {
      title: "not issued",
      vendorId: busyVendor.id,
      propertyIds: [siteB.id],
      deliverables: ["PHOTOS"],
    });

    const data = await getOperationsDashboard(staffCtx());
    // A draft is not work in flight — counting it would tell a dispatcher a
    // crew is out when nobody has been sent anywhere.
    expect(data.counts.openJobs).toBe(1);
    expect(data.counts.draftJobs).toBe(1);
    expect(data.openJobs.map((j) => j.title)).toEqual([`Sweep ${suffix}`]);
  });

  it("reports route progress per site from linked evidence", async () => {
    const job = await issuedJob([siteA.id], [{ label: "North" }, { label: "South" }, { label: "Rear" }]);
    const shots = await prisma.captureShot.findMany({
      where: { site: { jobId: job.id } },
      orderBy: { sequence: "asc" },
    });
    await uploadPhoto(siteA.id, shots[0].id);
    await uploadPhoto(siteA.id, shots[1].id);

    const data = await getOperationsDashboard(staffCtx());
    const site = data.openJobs[0].sites[0];
    expect(site.shotsTotal).toBe(3);
    // Counted from evidence, never from a flag: a route someone can tick off
    // without walking it is worth nothing.
    expect(site.shotsCaptured).toBe(2);
  });

  it("queues submitted sites oldest first and surfaces the rejection reason", async () => {
    const job = await issuedJob([siteA.id, siteB.id]);
    const sites = await prisma.captureJobSite.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "asc" } });

    await uploadPhoto(sites[0].propertyId);
    await submitCaptureSite(vendorCtx(), job.id, sites[0].id);
    await uploadPhoto(sites[1].propertyId);
    await submitCaptureSite(vendorCtx(), job.id, sites[1].id);

    let data = await getOperationsDashboard(staffCtx());
    expect(data.counts.awaitingReview).toBe(2);
    const submittedTimes = data.awaitingReview.map((r) => r.submittedAt?.getTime() ?? 0);
    expect(submittedTimes).toEqual([...submittedTimes].sort((a, b) => a - b));

    await reviewCaptureSite(staffCtx(), job.id, sites[0].id, { accept: false, reason: "Blurry north elevation" });
    data = await getOperationsDashboard(staffCtx());
    expect(data.counts.awaitingReview).toBe(1);
    const returned = data.openJobs[0].sites.find((s) => s.id === sites[0].id);
    // The reason has to reach the dashboard, not just the vendor's
    // notification — whoever picks this job up next needs to know why.
    expect(returned?.rejectionReason).toBe("Blurry north elevation");
  });

  it("marks a job overdue by a negative day count", async () => {
    const job = await createCaptureJob(staffCtx(), {
      title: "late",
      vendorId: busyVendor.id,
      propertyIds: [siteA.id],
      deliverables: ["PHOTOS"],
      dueDate: new Date(Date.now() - 3 * 86400000),
    });
    await issueCaptureJob(staffCtx(), job.id);

    const data = await getOperationsDashboard(staffCtx());
    expect(data.counts.overdueJobs).toBe(1);
    expect(data.openJobs[0].daysUntilDue).toBeLessThan(0);
  });
});

describe("who is on it", () => {
  it("lists every vendor, marking the ones with nothing on as free", async () => {
    await issuedJob([siteA.id]);
    const data = await getOperationsDashboard(staffCtx());

    // The roster is the whole roster. The question it answers is "who can
    // take the next job", and the answer is usually someone with nothing on.
    expect(data.counts.totalCrews).toBe(2);
    expect(data.counts.activeCrews).toBe(1);

    const busy = data.crews.find((c) => c.vendorId === busyVendor.id)!;
    const idle = data.crews.find((c) => c.vendorId === idleVendor.id)!;
    expect(busy.openJobCount).toBe(1);
    expect(busy.siteCount).toBe(1);
    expect(busy.contactEmail).toBe("busy@example.com");
    expect(idle.openJobCount).toBe(0);
  });

  it("derives last-upload location from the newest file across their live sites", async () => {
    await issuedJob([siteA.id, siteB.id]);

    await prisma.evidence.create({
      data: {
        organizationId: org.id,
        propertyId: siteA.id,
        type: "PHOTO",
        storageKey: `${siteA.id}/${crypto.randomUUID()}-old.jpg`,
        uploadedById: vendorUser.id,
        createdAt: new Date(Date.now() - 6 * 3600000),
      },
    });
    const recent = await prisma.evidence.create({
      data: {
        organizationId: org.id,
        propertyId: siteB.id,
        type: "PHOTO",
        storageKey: `${siteB.id}/${crypto.randomUUID()}-new.jpg`,
        uploadedById: vendorUser.id,
        createdAt: new Date(Date.now() - 10 * 60000),
      },
    });

    const data = await getOperationsDashboard(staffCtx());
    const busy = data.crews.find((c) => c.vendorId === busyVendor.id)!;
    // The NEWEST upload wins, not the first site on the job. Reporting the
    // wrong one sends a dispatcher to a site the crew left hours ago.
    expect(busy.lastUploadPropertyName).toContain("ops-site-b");
    expect(busy.lastUploadAt?.getTime()).toBe(recent.createdAt.getTime());
  });

  it("reports no upload location for a crew that has delivered nothing yet", async () => {
    await issuedJob([siteA.id]);
    const data = await getOperationsDashboard(staffCtx());
    const busy = data.crews.find((c) => c.vendorId === busyVendor.id)!;
    expect(busy.lastUploadAt).toBeNull();
    expect(busy.lastUploadPropertyName).toBeNull();
  });

  it("does not attribute another vendor's upload to an idle crew", async () => {
    await issuedJob([siteA.id]);
    await uploadPhoto(siteA.id);

    const data = await getOperationsDashboard(staffCtx());
    const idle = data.crews.find((c) => c.vendorId === idleVendor.id)!;
    expect(idle.lastUploadAt).toBeNull();
  });
});

describe("scope", () => {
  it("shows a scoped manager only jobs touching their own sites", async () => {
    await issuedJob([unscopedSite.id]);
    const mine = await issuedJob([siteA.id]);

    const data = await getOperationsDashboard(scopedCtx(siteA.id));
    expect(data.openJobs).toHaveLength(1);
    expect(data.openJobs[0].id).toBe(mine.id);
    // And the sites within a job they can see are filtered too, so a job
    // spanning both does not leak the site they have no grant for.
    expect(data.openJobs[0].sites.map((s) => s.propertyId)).toEqual([siteA.id]);
  });

  it("filters a multi-site job down to the sites in scope", async () => {
    const job = await issuedJob([siteA.id, unscopedSite.id]);
    const data = await getOperationsDashboard(scopedCtx(siteA.id));

    expect(data.openJobs[0].id).toBe(job.id);
    expect(data.openJobs[0].sitesTotal).toBe(1);
    expect(data.openJobs[0].sites.map((s) => s.propertyId)).toEqual([siteA.id]);
  });

  it("keeps a scoped manager's review queue inside their grants", async () => {
    const job = await issuedJob([unscopedSite.id]);
    const site = await prisma.captureJobSite.findFirstOrThrow({ where: { jobId: job.id } });
    await uploadPhoto(unscopedSite.id);
    await submitCaptureSite(vendorCtx(), job.id, site.id);

    const theirs = await getOperationsDashboard(scopedCtx(siteA.id));
    expect(theirs.counts.awaitingReview).toBe(0);
    const orgWide = await getOperationsDashboard(staffCtx());
    expect(orgWide.counts.awaitingReview).toBe(1);
  });
});
