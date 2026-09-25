import { prisma } from "@/lib/prisma";
import { CaptureJobSiteStatus, CaptureJobStatus } from "@/generated/prisma/client";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { getFacilitiesActionQueue, getMyFieldWork } from "@/lib/dashboard-views";

/**
 * THE OPERATIONS DASHBOARD.
 *
 * One screen that answers the four questions someone running capture work
 * actually asks: what jobs are running, who is on each one, where are they,
 * and what is waiting on me.
 *
 * Before this, those answers were spread over the capture-jobs list, each
 * job's detail page, and the vendor table in settings — so "is Store #1052
 * done?" meant three page loads, and "who is free to take the Midwest sweep?"
 * meant knowing the roster by heart.
 *
 * WHERE THE CREW IS, honestly. There is no GPS and no check-in button, so
 * presence is DERIVED: the most recent upload on any of a vendor's open sites,
 * and which site it landed on. "Last uploaded to Store #1052, 14 minutes ago"
 * is a true statement. "Currently at Store #1052" would not be — they may have
 * driven home. The distinction is kept in the field names and in the wording
 * the component renders, because a dispatcher who is told the wrong one will
 * make a phone call that wastes somebody's afternoon.
 */

/** Statuses in which a job is still live work. Mirrors the service's own list. */
const OPEN_JOB_STATUSES: CaptureJobStatus[] = [
  CaptureJobStatus.ISSUED,
  CaptureJobStatus.SUBMITTED,
  CaptureJobStatus.REJECTED,
];

export interface OpsSite {
  id: string;
  propertyId: string;
  propertyName: string;
  city: string | null;
  state: string | null;
  status: CaptureJobSiteStatus;
  shotsTotal: number;
  shotsCaptured: number;
  rejectionReason: string | null;
}

export interface OpsJob {
  id: string;
  title: string;
  status: CaptureJobStatus;
  vendorId: string | null;
  vendorName: string | null;
  dueDate: Date | null;
  /** Negative when overdue. Null when the job carries no due date. */
  daysUntilDue: number | null;
  sitesTotal: number;
  sitesAccepted: number;
  sitesAwaitingReview: number;
  sites: OpsSite[];
}

export interface OpsCrew {
  vendorId: string;
  vendorName: string;
  trade: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  openJobCount: number;
  siteCount: number;
  /** The site their most recent upload landed on, not where they are standing. */
  lastUploadPropertyName: string | null;
  lastUploadAt: Date | null;
  /** Sites of theirs that are submitted and waiting on a reviewer. */
  awaitingReview: number;
}

export async function getOperationsDashboard(ctx: SessionContext) {
  const scope = propertyScopeWhere(ctx);

  // Jobs first. Everything else is derived from these, so a single scoped
  // query here is what keeps the whole page inside the caller's access.
  const jobs = await prisma.captureJob.findMany({
    where: { organizationId: ctx.organizationId, sites: { some: { property: scope } } },
    include: {
      vendor: { select: { id: true, name: true } },
      sites: {
        where: { property: scope },
        include: {
          property: { select: { id: true, name: true, city: true, state: true } },
          shots: { select: { id: true, _count: { select: { evidence: true } } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
  });

  const now = Date.now();
  const shaped: OpsJob[] = jobs.map((job) => {
    const sites: OpsSite[] = job.sites.map((site) => ({
      id: site.id,
      propertyId: site.propertyId,
      propertyName: site.property.name,
      city: site.property.city,
      state: site.property.state,
      status: site.status,
      shotsTotal: site.shots.length,
      shotsCaptured: site.shots.filter((s) => s._count.evidence > 0).length,
      rejectionReason: site.rejectionReason,
    }));

    return {
      id: job.id,
      title: job.title,
      status: job.status,
      vendorId: job.vendorId,
      vendorName: job.vendor?.name ?? null,
      dueDate: job.dueDate,
      daysUntilDue: job.dueDate
        ? Math.floor((new Date(job.dueDate).getTime() - now) / 86400000)
        : null,
      sitesTotal: sites.length,
      sitesAccepted: sites.filter((s) => s.status === CaptureJobSiteStatus.ACCEPTED).length,
      sitesAwaitingReview: sites.filter((s) => s.status === CaptureJobSiteStatus.SUBMITTED).length,
      sites,
    };
  });

  const openJobs = shaped.filter((j) => OPEN_JOB_STATUSES.includes(j.status));
  const draftJobs = shaped.filter((j) => j.status === CaptureJobStatus.DRAFT);

  // The roster: every vendor, not only the busy ones, because the question
  // this answers is "who can take the next job" and the answer is usually
  // somebody with nothing on.
  const vendors = await prisma.vendor.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, name: true, trade: true, contactEmail: true, contactPhone: true },
    orderBy: { name: "asc" },
    take: 200,
  });

  // Derived presence. One grouped query rather than one per vendor: a 40-crew
  // roster would otherwise be 40 round trips to render a sidebar.
  const openSitePropertyIds = openJobs.flatMap((j) => j.sites.map((s) => s.propertyId));
  const latestUploads = openSitePropertyIds.length
    ? await prisma.evidence.groupBy({
        by: ["propertyId"],
        where: { organizationId: ctx.organizationId, propertyId: { in: openSitePropertyIds } },
        _max: { createdAt: true },
      })
    : [];
  const lastUploadByProperty = new Map(
    latestUploads.map((row) => [row.propertyId, row._max.createdAt]),
  );

  const crews: OpsCrew[] = vendors.map((vendor) => {
    const theirJobs = openJobs.filter((j) => j.vendorId === vendor.id);
    const theirSites = theirJobs.flatMap((j) => j.sites);

    // The most recent upload across all of their live sites, and which site
    // it was. Ties go to whichever the reduce sees first; a tie means two
    // uploads in the same millisecond, which is not a distinction a
    // dispatcher cares about.
    let lastAt: Date | null = null;
    let lastProperty: string | null = null;
    for (const site of theirSites) {
      const at = lastUploadByProperty.get(site.propertyId) ?? null;
      if (at && (!lastAt || at > lastAt)) {
        lastAt = at;
        lastProperty = site.propertyName;
      }
    }

    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      trade: vendor.trade,
      contactEmail: vendor.contactEmail,
      contactPhone: vendor.contactPhone,
      openJobCount: theirJobs.length,
      siteCount: theirSites.length,
      lastUploadPropertyName: lastProperty,
      lastUploadAt: lastAt,
      awaitingReview: theirSites.filter((s) => s.status === CaptureJobSiteStatus.SUBMITTED).length,
    };
  });

  // The actionable queue. Flattened across jobs and sorted oldest-submitted
  // first, because the thing a reviewer should do next is the thing that has
  // been waiting longest, not whatever job happens to sort first by due date.
  const awaitingReview = await prisma.captureJobSite.findMany({
    where: {
      status: CaptureJobSiteStatus.SUBMITTED,
      property: scope,
      job: { organizationId: ctx.organizationId },
    },
    include: {
      property: { select: { id: true, name: true } },
      job: { select: { id: true, title: true, vendor: { select: { name: true } } } },
    },
    orderBy: { submittedAt: "asc" },
    take: 50,
  });

  // Folded in rather than dropped. Collapsing eight dashboards into three
  // would otherwise have cost an Inspector their own assignment list and a
  // Facilities Manager their action queue — a simplification that removes
  // function is just a deletion.
  const [mine, attention] = await Promise.all([
    getMyFieldWork(ctx),
    getFacilitiesActionQueue(ctx),
  ]);

  return {
    mine: {
      assessments: mine.myAssessments,
      issues: mine.myIssues,
    },
    attention: {
      criticalIssues: attention.criticalIssues.length,
      highIssues: attention.highIssues.length,
      overdueAssessments: attention.overdueAssessments.length,
    },
    counts: {
      openJobs: openJobs.length,
      draftJobs: draftJobs.length,
      awaitingReview: awaitingReview.length,
      // Crews with something live, which is the number a dispatcher reads as
      // "how many people are out". Distinct from the roster size below.
      activeCrews: crews.filter((c) => c.openJobCount > 0).length,
      totalCrews: crews.length,
      overdueJobs: openJobs.filter((j) => j.daysUntilDue !== null && j.daysUntilDue < 0).length,
    },
    openJobs,
    draftJobs,
    crews,
    awaitingReview: awaitingReview.map((site) => ({
      siteId: site.id,
      jobId: site.job.id,
      jobTitle: site.job.title,
      vendorName: site.job.vendor?.name ?? null,
      propertyName: site.property.name,
      submittedAt: site.submittedAt,
    })),
  };
}
