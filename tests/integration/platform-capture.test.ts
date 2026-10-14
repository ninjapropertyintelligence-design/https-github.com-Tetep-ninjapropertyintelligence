import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import {
  createCaptureJobForOrganization,
  createVendorForOrganization,
  createVendorLogin,
  listAllCaptureJobs,
  listOrganizationVendors,
} from "@/lib/platform-capture-service";
import { contextForCaptureEvidence, contextForCaptureJob, propertyScopeWhere } from "@/lib/tenant-scope";
import { acceptInvitation } from "@/lib/invitation-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * The platform team runs capture work for its customers: it adds the vendor
 * company, gives the vendor a login, orders the job on the customer's sites,
 * and approves the work. These are the cases where that reach across
 * customers could leak: a customer, or support impersonating one, borrowing
 * it; or the platform team reaching a customer's own files rather than the
 * vendor deliveries it reviews.
 */

const suffix = `pc${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string; name: string };
let otherOrg: { id: string; name: string };
let site: { id: string };
let otherSite: { id: string };
let operator: { id: string };
let owner: { id: string };
const createdEmails: string[] = [];

function platformCtx(): SessionContext {
  return {
    userId: operator.id,
    userName: "Platform Operator",
    userEmail: `op-${suffix}@example.com`,
    isPlatformAdmin: true,
    organizationId: "",
    organizationName: "",
    membershipId: "",
    role: Role.PLATFORM_ADMIN,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

function ownerCtx(): SessionContext {
  return {
    ...platformCtx(),
    userId: owner.id,
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: org.name,
    membershipId: "m",
    role: Role.OWNER,
  };
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `PC ${suffix}`, slug: `pc-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `PC other ${suffix}`, slug: `pc-other-${suffix}` } });
  operator = await prisma.user.create({
    data: { email: `op-${suffix}@example.com`, passwordHash: "x", name: "Operator", isPlatformAdmin: true },
  });
  owner = await prisma.user.create({ data: { email: `owner-${suffix}@example.com`, passwordHash: "x", name: "Owner" } });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });
  const makeSite = async (organizationId: string, name: string) => {
    const pf = await prisma.portfolio.create({ data: { organizationId, name: `PF ${name}` } });
    return prisma.property.create({
      data: { organizationId, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1 Main", city: "X", state: "TX", postalCode: "1" },
    });
  };
  site = await makeSite(org.id, "site");
  otherSite = await makeSite(otherOrg.id, "other");
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [operator.id, owner.id] } } });
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
});

describe("the platform team sets a vendor up and sends it out", () => {
  it("adds a vendor, gives it a login, and issues a job on the customer's sites", async () => {
    const vendor = await createVendorForOrganization(platformCtx(), org.id, { name: "Sky Capture", trade: "Drone" });
    expect(vendor.organizationId).toBe(org.id);

    const email = `pilot-${suffix}@example.com`;
    createdEmails.push(email);
    const login = await createVendorLogin(platformCtx(), vendor.id, { email, name: "Pilot" });
    expect(login.acceptUrl).toMatch(/\/invite\?token=/);
    expect(login.invitation.role).toBe(Role.VENDOR);
    expect(login.invitation.vendorId).toBe(vendor.id);

    // The link is the vendor's credential: it becomes a vendor membership in
    // the customer organization, tied to the vendor company.
    const token = decodeURIComponent(new URL(login.acceptUrl).searchParams.get("token")!);
    await acceptInvitation(token, { name: "Pilot", password: "a-long-enough-password-1" }, null);
    const membership = await prisma.membership.findFirstOrThrow({ where: { organizationId: org.id, user: { email } } });
    expect(membership.role).toBe(Role.VENDOR);
    expect(membership.vendorId).toBe(vendor.id);

    const job = await createCaptureJobForOrganization(
      platformCtx(),
      org.id,
      { title: "Sweep", vendorId: vendor.id, propertyIds: [site.id], deliverables: ["PHOTOS"] },
      { issue: true },
    );
    const stored = await prisma.captureJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe("ISSUED");
    expect(stored.organizationId).toBe(org.id);

    const listed = await listAllCaptureJobs(platformCtx());
    expect(listed.some((j) => j.id === job.id && j.organization.id === org.id)).toBe(true);
    const vendors = await listOrganizationVendors(platformCtx(), org.id);
    expect(vendors.find((v) => v.id === vendor.id)?.memberships).toHaveLength(1);
  });

  it("will not put another customer's site on a job", async () => {
    const vendor = await createVendorForOrganization(platformCtx(), org.id, { name: "Ground Crew" });
    await expect(
      createCaptureJobForOrganization(
        platformCtx(),
        org.id,
        { title: "Crossed", vendorId: vendor.id, propertyIds: [otherSite.id], deliverables: ["PHOTOS"] },
        { issue: false },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("is refused to a customer, and to support impersonating one", async () => {
    await expect(createVendorForOrganization(ownerCtx(), org.id, { name: "Nope" })).rejects.toMatchObject({ status: 403 });
    await expect(listAllCaptureJobs(ownerCtx())).rejects.toMatchObject({ status: 403 });

    const impersonating: SessionContext = {
      ...platformCtx(),
      impersonation: {
        sessionId: "s",
        adminUserId: operator.id,
        adminName: "Operator",
        adminEmail: "op@example.com",
        reason: "support",
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    };
    await expect(listAllCaptureJobs(impersonating)).rejects.toMatchObject({ status: 403 });
    // And impersonation keeps the customer's own context: no reach into the job's org.
    expect(await contextForCaptureJob(impersonating, "anything")).toBe(impersonating);
  });
});

describe("the platform team's reach inside a customer", () => {
  it("binds to the organization that owns the job, and sees only that organization's sites", async () => {
    const vendor = await createVendorForOrganization(platformCtx(), org.id, { name: "Binder" });
    const job = await createCaptureJobForOrganization(
      platformCtx(),
      org.id,
      { title: "Bind", vendorId: vendor.id, propertyIds: [site.id], deliverables: ["PHOTOS"] },
      { issue: false },
    );
    const acting = await contextForCaptureJob(platformCtx(), job.id);
    expect(acting.organizationId).toBe(org.id);
    const visible = await prisma.property.findMany({ where: { ...propertyScopeWhere(acting), id: { in: [site.id, otherSite.id] } } });
    expect(visible.map((p) => p.id)).toEqual([site.id]);

    // The operator's own console context reaches no customer's properties at all.
    expect(await prisma.property.count({ where: propertyScopeWhere(platformCtx()) })).toBe(0);
  });

  it("reads vendor deliveries, never the customer's own files", async () => {
    const vendor = await createVendorForOrganization(platformCtx(), org.id, { name: "Reader" });
    const job = await createCaptureJobForOrganization(
      platformCtx(),
      org.id,
      { title: "Read", vendorId: vendor.id, propertyIds: [site.id], deliverables: ["PHOTOS"] },
      { issue: true },
    );
    const jobSite = await prisma.captureJobSite.findFirstOrThrow({ where: { jobId: job.id } });
    const delivered = await prisma.evidence.create({
      data: { organizationId: org.id, propertyId: site.id, type: "PHOTO", storageKey: `${suffix}/d.jpg`, uploadedById: operator.id, captureJobSiteId: jobSite.id },
    });
    const customersOwn = await prisma.evidence.create({
      data: { organizationId: org.id, propertyId: site.id, type: "PHOTO", storageKey: `${suffix}/own.jpg`, uploadedById: operator.id },
    });

    expect((await contextForCaptureEvidence(platformCtx(), delivered.id)).organizationId).toBe(org.id);
    await expect(contextForCaptureEvidence(platformCtx(), customersOwn.id)).rejects.toMatchObject({ status: 404 });
  });
});
