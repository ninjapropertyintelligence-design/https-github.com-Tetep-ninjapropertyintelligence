import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

/**
 * Audit trail (spec §48): login, permission changes, property/asset/issue
 * changes, document access, exports, admin actions, impersonation,
 * subscription changes. Distinct from Event (`lib/events.ts`): Event feeds
 * product-facing history/notifications, AuditLog is the compliance/security
 * trail platform admins and org owners can inspect but end users don't see
 * threaded into feature UI.
 */
export async function writeAuditLog(params: {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  request?: NextRequest;
}) {
  const ipAddress =
    params.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;

  return prisma.auditLog.create({
    data: {
      organizationId: params.organizationId ?? null,
      actorUserId: params.actorUserId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: (params.metadata ?? {}) as unknown as Prisma.InputJsonValue,
      ipAddress,
    },
  });
}
