import { prisma } from "@/lib/prisma";
// From tenant-scope, not session-context. These are the same values —
// session-context only re-exports them — but that module reaches next-auth
// and `next/headers`, so importing it here drags the whole auth graph into
// every caller. The service layer depends on the pure scope logic.
import { issueScopeWhere, propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";

/** Facilities Manager dashboard (spec §6): "what needs action?" */
export async function getFacilitiesActionQueue(ctx: SessionContext) {
  const [criticalIssues, highIssues, overdueAssessments, deterioratedAssets] = await Promise.all([
    prisma.issue.findMany({
      where: { AND: [issueScopeWhere(ctx), { severity: "CRITICAL", status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } }] },
      include: { property: { select: { id: true, name: true } }, asset: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.issue.findMany({
      where: { AND: [issueScopeWhere(ctx), { severity: "HIGH", status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } }] },
      include: { property: { select: { id: true, name: true } }, asset: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.assessment.findMany({
      where: {
        organizationId: ctx.organizationId,
        property: propertyScopeWhere(ctx),
        status: { in: ["DRAFT", "IN_PROGRESS"] },
        scheduledFor: { lt: new Date() },
      },
      include: { property: { select: { id: true, name: true } } },
      take: 20,
    }),
    prisma.assetConditionHistory.findMany({
      where: { asset: { property: propertyScopeWhere(ctx) }, newScore: { lt: 50 } },
      include: { asset: { select: { id: true, name: true, propertyId: true, property: { select: { name: true } } } } },
      orderBy: { changedAt: "desc" },
      take: 10,
    }),
  ]);

  return { criticalIssues, highIssues, overdueAssessments, deterioratedAssets };
}

/** Inspector / Technician "my work today" dashboard (spec §8, §11). */
export async function getMyFieldWork(ctx: SessionContext) {
  const [myAssessments, myIssues] = await Promise.all([
    prisma.assessment.findMany({
      where: { organizationId: ctx.organizationId, inspectorId: ctx.userId, status: { in: ["DRAFT", "IN_PROGRESS"] } },
      include: { property: { select: { id: true, name: true, city: true, state: true } }, template: { select: { name: true } } },
      orderBy: { scheduledFor: "asc" },
      take: 25,
    }),
    prisma.issue.findMany({
      where: { organizationId: ctx.organizationId, assigneeId: ctx.userId, status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } },
      include: { property: { select: { id: true, name: true } } },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 25,
    }),
  ]);

  const propertyIds = new Set<string>();
  myAssessments.forEach((a) => propertyIds.add(a.propertyId));
  myIssues.forEach((i) => propertyIds.add(i.propertyId));

  return { myAssessments, myIssues, propertyCount: propertyIds.size };
}

/**
 * Vendor "assigned work" dashboard (spec §17). Vendor sees only their assignments.
 *
 * Capture jobs are listed FIRST and issues second, because since capture jobs
 * exist the job is the vendor's actual work — this view showed only issues,
 * so a subcontractor sent on a 40-site sweep logged in to an empty page.
 */
export async function getVendorWork(ctx: SessionContext) {
  const captureJobs = ctx.vendorId
    ? await prisma.captureJob.findMany({
        where: {
          organizationId: ctx.organizationId,
          vendorId: ctx.vendorId,
          // The same open set the capture-job service uses. A closed job must
          // not appear as outstanding work.
          status: { in: ["ISSUED", "SUBMITTED", "REJECTED"] },
        },
        include: {
          sites: {
            include: {
              property: { select: { id: true, name: true, city: true, state: true } },
              shots: { select: { id: true, _count: { select: { evidence: true } } } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        take: 50,
      })
    : [];

  const issues = await prisma.issue.findMany({
    where: issueScopeWhere(ctx),
    include: { property: { select: { id: true, name: true, city: true, state: true } }, asset: { select: { id: true, name: true } } },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
  const propertyIds = new Set(issues.map((i) => i.propertyId));
  const dueThisWeek = issues.filter((i) => i.dueDate && new Date(i.dueDate).getTime() - Date.now() < 7 * 86400000).length;

  // Sites still to deliver: anything not yet accepted. What a subcontractor
  // wants on their home screen is how many stops are left, not how many they
  // were given.
  const sitesOutstanding = captureJobs.reduce(
    (total, job) => total + job.sites.filter((s) => s.status !== "ACCEPTED").length,
    0,
  );
  const sitesReturned = captureJobs.reduce(
    (total, job) => total + job.sites.filter((s) => s.status === "REJECTED").length,
    0,
  );

  return {
    captureJobs: captureJobs.map((job) => ({
      id: job.id,
      title: job.title,
      dueDate: job.dueDate,
      sites: job.sites.map((site) => ({
        id: site.id,
        propertyId: site.propertyId,
        propertyName: site.property.name,
        city: site.property.city,
        state: site.property.state,
        status: site.status,
        shotsTotal: site.shots.length,
        shotsCaptured: site.shots.filter((s) => s._count.evidence > 0).length,
        rejectionReason: site.rejectionReason,
      })),
    })),
    sitesOutstanding,
    sitesReturned,
    issues,
    propertyCount: propertyIds.size,
    dueThisWeek,
  };
}
