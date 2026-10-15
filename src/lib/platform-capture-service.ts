import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { CaptureJobSiteStatus, Role } from "@/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { createCaptureJob, issueCaptureJob, type CreateCaptureJobInput } from "@/lib/capture-job-service";
import { createVendorInvitationAsPlatform } from "@/lib/invitation-service";
import { createProperty, type CreatePropertyInput } from "@/lib/property-service";
import { isPlatformOperator, platformActingContext, type SessionContext } from "@/lib/tenant-scope";

/**
 * The platform team's side of capture work.
 *
 * The platform operator runs the vendor network for every customer: it adds
 * the vendor company to the customer's organization, gives the vendor's
 * people their logins, orders the capture job on the customer's sites, and
 * approves what comes back. The customer sees the work only once it is
 * approved (see `captureReviewWhere`).
 *
 * Every function here starts from the operator's own session and binds it to
 * one customer organization with `platformActingContext`, so the existing
 * scoped services do the work and the permission engine decides what is
 * allowed — there is no second, platform-only copy of the rules.
 */

function requireOperator(ctx: SessionContext) {
  if (!isPlatformOperator(ctx)) throw new ApiError(403, "Platform admin only");
}

async function actingIn(ctx: SessionContext, organizationId: string) {
  requireOperator(ctx);
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true },
  });
  if (!organization) throw new ApiError(404, "Organization not found");
  return platformActingContext(ctx, organization);
}

export async function listCustomerOrganizations(ctx: SessionContext) {
  requireOperator(ctx);
  return prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** What the "new capture job" form needs for one customer: its sites and its vendors. */
export async function getOrganizationCaptureSetup(ctx: SessionContext, organizationId: string) {
  const acting = await actingIn(ctx, organizationId);
  const [properties, vendors, portfolios] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: acting.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true, state: true, region: { select: { name: true } } },
      take: 2000,
    }),
    prisma.vendor.findMany({
      where: { organizationId: acting.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, trade: true },
    }),
    // Where a new site can be filed, for "add a new site".
    prisma.portfolio.findMany({
      where: { organizationId: acting.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, regions: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
    }),
  ]);
  return {
    organization: { id: acting.organizationId, name: acting.organizationName },
    properties,
    vendors,
    portfolios,
  };
}

/** Every vendor company in one customer organization, with who can sign in for it. */
export async function listOrganizationVendors(ctx: SessionContext, organizationId: string) {
  const acting = await actingIn(ctx, organizationId);
  const now = new Date();
  return prisma.vendor.findMany({
    where: { organizationId: acting.organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      trade: true,
      contactEmail: true,
      contactPhone: true,
      memberships: {
        where: { role: Role.VENDOR },
        select: { id: true, user: { select: { name: true, email: true, isActive: true } } },
      },
      invitations: {
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        select: { id: true, email: true, expiresAt: true },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { captureJobs: true } },
    },
  });
}

export async function createVendorForOrganization(
  ctx: SessionContext,
  organizationId: string,
  input: { name: string; trade?: string | null; contactEmail?: string | null; contactPhone?: string | null },
) {
  const acting = await actingIn(ctx, organizationId);
  const name = input.name.trim();
  if (!name) throw new ApiError(400, "Enter the vendor company's name");
  const vendor = await prisma.vendor.create({
    data: {
      organizationId: acting.organizationId,
      name,
      trade: input.trade?.trim() || null,
      contactEmail: input.contactEmail?.trim() || null,
      contactPhone: input.contactPhone?.trim() || null,
    },
  });
  await writeAuditLog({
    organizationId: acting.organizationId,
    actorUserId: ctx.userId,
    action: "vendor.created",
    entityType: "Vendor",
    entityId: vendor.id,
    metadata: { name, byPlatform: true },
  });
  return vendor;
}

/**
 * Adds a site the customer does not have yet, so it can go on a capture job.
 *
 * Goes through the same property creation as the customer's own — portfolio
 * and region checked against the organization, the address geocoded — so a
 * site the platform team adds is indistinguishable from one the customer did.
 */
export async function createSiteForOrganization(ctx: SessionContext, organizationId: string, input: CreatePropertyInput) {
  const acting = await actingIn(ctx, organizationId);
  return createProperty(acting, input);
}

/** Gives one of a vendor's people a login: an invitation they accept by setting a password. */
export async function createVendorLogin(
  ctx: SessionContext,
  vendorId: string,
  input: { email: string; name?: string | null },
) {
  requireOperator(ctx);
  // The vendor names the organization: a login is always into the customer
  // whose sites that vendor company was added to.
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { organizationId: true } });
  if (!vendor) throw new ApiError(404, "Vendor not found");
  const acting = await actingIn(ctx, vendor.organizationId);
  return createVendorInvitationAsPlatform(acting, { ...input, vendorId });
}

/**
 * Orders capture work on a customer's sites.
 *
 * Saved as a draft, then — when `issue` is set — sent to the vendor in the
 * same step. Issuing is what gives the vendor access to the sites, so it is
 * the operator's explicit choice rather than a side effect of saving.
 */
export async function createCaptureJobForOrganization(
  ctx: SessionContext,
  organizationId: string,
  input: CreateCaptureJobInput,
  options: { issue: boolean },
) {
  const acting = await actingIn(ctx, organizationId);
  const job = await createCaptureJob(acting, input);
  await writeAuditLog({
    organizationId: acting.organizationId,
    actorUserId: ctx.userId,
    action: "capture_job.created",
    entityType: "CaptureJob",
    entityId: job.id,
    metadata: { title: job.title, siteCount: job.sites.length, vendorId: job.vendorId, byPlatform: true },
  });
  if (options.issue) await issueCaptureJob(acting, job.id);
  return job;
}

/**
 * Every capture job across every customer, with what is waiting on the
 * platform team: sites a vendor has submitted and nobody has reviewed yet.
 */
export async function listAllCaptureJobs(ctx: SessionContext) {
  requireOperator(ctx);
  const jobs = await prisma.captureJob.findMany({
    include: {
      organization: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true } },
      sites: {
        select: {
          id: true,
          status: true,
          property: { select: { name: true, latitude: true, longitude: true } },
        },
      },
    },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 500,
  });
  return jobs.map((job) => ({
    ...job,
    awaitingReview: job.sites.filter((s) => s.status === CaptureJobSiteStatus.SUBMITTED).length,
  }));
}
