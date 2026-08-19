import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { issueScopeWhere, propertyScopeWhere } from "@/lib/session-context";
import { createIssueSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { notifyPropertyStakeholders } from "@/lib/notifications";
import { recalculatePropertyHealth } from "@/lib/scoring";

// GET /api/v1/issues?propertyId=&severity=&status=&assigneeId=&vendorId=&search=&page=&pageSize=
export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const propertyId = url.searchParams.get("propertyId");
  const severity = url.searchParams.get("severity");
  const status = url.searchParams.get("status");
  const assigneeId = url.searchParams.get("assigneeId");
  const vendorId = url.searchParams.get("vendorId");
  const search = url.searchParams.get("search");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "25")));

  const where: Prisma.IssueWhereInput = { AND: [issueScopeWhere(ctx)] };
  const and = where.AND as Prisma.IssueWhereInput[];
  if (propertyId) and.push({ propertyId });
  if (severity) and.push({ severity: severity as never });
  if (status) and.push({ status: status as never });
  if (assigneeId) and.push({ assigneeId });
  if (vendorId) and.push({ vendorId });
  if (search) and.push({ title: { contains: search, mode: "insensitive" } });

  const [items, total] = await Promise.all([
    prisma.issue.findMany({
      where,
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        property: { select: { id: true, name: true } },
        asset: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
      },
    }),
    prisma.issue.count({ where }),
  ]);

  return NextResponse.json({ items, total, page, pageSize });
});

// POST /api/v1/issues
export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canCreateIssues");
  const body = await req.json();
  const input = createIssueSchema.parse(body);

  const property = await prisma.property.findFirst({
    where: { AND: [{ id: input.propertyId }, propertyScopeWhere(ctx)] },
  });
  if (!property) throw new ApiError(400, "Invalid propertyId, or you don't have access to it");

  if (input.assetId) {
    const asset = await prisma.asset.findFirst({
      where: { id: input.assetId, propertyId: input.propertyId },
    });
    if (!asset) throw new ApiError(400, "Invalid assetId for this property");
  }

  const issue = await prisma.issue.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: input.propertyId,
      buildingId: input.buildingId ?? null,
      areaId: input.areaId ?? null,
      assetId: input.assetId ?? null,
      title: input.title,
      description: input.description ?? null,
      severity: input.severity,
      source: input.source,
      assigneeId: input.assigneeId ?? null,
      vendorId: input.vendorId ?? null,
      estimatedCost: input.estimatedCost ?? null,
      dueDate: input.dueDate ?? null,
      createdById: ctx.userId,
    },
  });

  await recalculatePropertyHealth(input.propertyId);

  await Promise.all([
    emitEvent({
      organizationId: ctx.organizationId,
      propertyId: input.propertyId,
      type: EVENT_TYPES.ISSUE_CREATED,
      actorUserId: ctx.userId,
      payload: { issueId: issue.id, title: issue.title, severity: issue.severity },
    }),
    writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "issue.created",
      entityType: "Issue",
      entityId: issue.id,
      metadata: { severity: issue.severity },
    }),
    issue.severity === "CRITICAL"
      ? notifyPropertyStakeholders({
          propertyId: input.propertyId,
          type: "ISSUE_CRITICAL",
          title: `Critical issue: ${issue.title}`,
          body: `${property.name}`,
          link: `/issues/${issue.id}`,
        })
      : Promise.resolve(),
    issue.assigneeId
      ? prisma.notification.create({
          data: {
            organizationId: ctx.organizationId,
            userId: issue.assigneeId,
            type: "ISSUE_ASSIGNED",
            title: `Assigned: ${issue.title}`,
            body: property.name,
            link: `/issues/${issue.id}`,
          },
        })
      : Promise.resolve(),
  ]);

  return NextResponse.json(issue, { status: 201 });
});
