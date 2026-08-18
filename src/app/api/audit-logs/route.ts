import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiHandler } from "@/lib/api-utils";

/**
 * Audit log viewer (spec §21, §48). Platform admins see across all
 * organizations; org Owners see only their own organization's trail. Never
 * exposed to any other role.
 */
export const GET = withApiHandler(async (ctx, req) => {
  if (!ctx.isPlatformAdmin && ctx.role !== "OWNER") {
    throw new ApiError(403, "Only Owners and Platform Admins may view audit logs");
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? "50")));
  const action = url.searchParams.get("action");

  const where = ctx.isPlatformAdmin
    ? (action ? { action: { contains: action } } : {})
    : { organizationId: ctx.organizationId, ...(action ? { action: { contains: action } } : {}) };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { id: true, name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({ items, total, page, pageSize });
});
