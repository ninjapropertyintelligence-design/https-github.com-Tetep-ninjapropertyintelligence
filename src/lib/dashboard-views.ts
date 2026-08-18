import { prisma } from "@/lib/prisma";
import { SessionContext, issueScopeWhere, propertyScopeWhere } from "@/lib/session-context";

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

/** Vendor "assigned work" dashboard (spec §17). Vendor sees only their assignments. */
export async function getVendorWork(ctx: SessionContext) {
  const issues = await prisma.issue.findMany({
    where: issueScopeWhere(ctx),
    include: { property: { select: { id: true, name: true, city: true, state: true } }, asset: { select: { id: true, name: true } } },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
  const propertyIds = new Set(issues.map((i) => i.propertyId));
  const dueThisWeek = issues.filter((i) => i.dueDate && new Date(i.dueDate).getTime() - Date.now() < 7 * 86400000).length;

  return { issues, propertyCount: propertyIds.size, dueThisWeek };
}
