import { prisma } from "@/lib/prisma";
import { SessionContext } from "@/lib/tenant-scope";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { extractAndIndexDocument } from "@/lib/document-extraction";
import { getAIProvider } from "@/lib/ai/provider-factory";
import { NullProvider } from "@/lib/ai/providers/null-provider";

/**
 * Platform Admin operations (spec Phase 2 §18) — cross-organization
 * inspection and recovery actions, gated on `isPlatformAdmin` rather than
 * any org-scoped permission (a platform admin's whole point is to act
 * outside normal tenant boundaries for support purposes). Every action is
 * audit-logged. No direct database manipulation is required for these
 * common recovery flows.
 */
function requirePlatformAdmin(ctx: SessionContext) {
  if (!ctx.isPlatformAdmin) throw new ApiError(403, "Platform admin only");
}

export async function getIntegrationsOverview() {
  const [matterportConnections, failedCaptures, failedProcessingJobs, failedDocuments, recentAiLogs] = await Promise.all([
    prisma.matterportConnection.findMany({ include: { organization: { select: { name: true } } }, orderBy: { updatedAt: "desc" } }),
    prisma.droneCapture.findMany({
      where: { status: "FAILED" },
      include: { property: { select: { name: true, organizationId: true } } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.droneProcessingJob.findMany({
      where: { status: "FAILED" },
      include: { dataset: { include: { capture: { include: { property: { select: { name: true } } } } } } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.document.findMany({
      where: { indexStatus: "FAILED" },
      include: { property: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.aIQueryLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { organization: { select: { name: true } }, user: { select: { name: true } } } }),
  ]);

  const provider = getAIProvider();

  return {
    aiProvider: { name: provider.name, configured: !(provider instanceof NullProvider) },
    matterportConnections,
    failedCaptures,
    failedProcessingJobs,
    failedDocuments,
    recentAiLogs,
  };
}

export async function retryMatterportConnection(ctx: SessionContext, connectionId: string) {
  requirePlatformAdmin(ctx);
  const connection = await prisma.matterportConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new ApiError(404, "Matterport connection not found");

  const { connectMatterportForOrg } = await import("@/lib/matterport-service");
  // Impersonate the target org's context just enough to run the same
  // connect flow a member of that org would trigger.
  const orgCtx: SessionContext = { ...ctx, organizationId: connection.organizationId };
  const updated = await connectMatterportForOrg(orgCtx);

  await writeAuditLog({
    organizationId: connection.organizationId,
    actorUserId: ctx.userId,
    action: "admin.matterport_retry",
    entityType: "MatterportConnection",
    entityId: connection.id,
    metadata: { triggeredByPlatformAdmin: true },
  });

  return updated;
}

export async function retryDroneCapture(ctx: SessionContext, captureId: string) {
  requirePlatformAdmin(ctx);
  const capture = await prisma.droneCapture.findUnique({ where: { id: captureId } });
  if (!capture) throw new ApiError(404, "Drone capture not found");

  const updated = await prisma.droneCapture.update({ where: { id: capture.id }, data: { status: "UPLOADING", notes: null } });

  await writeAuditLog({
    actorUserId: ctx.userId,
    action: "admin.drone_capture_retry",
    entityType: "DroneCapture",
    entityId: capture.id,
    metadata: { triggeredByPlatformAdmin: true },
  });

  return updated;
}

export async function reindexDocument(ctx: SessionContext, documentId: string) {
  requirePlatformAdmin(ctx);
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw new ApiError(404, "Document not found");

  await extractAndIndexDocument(documentId);

  await writeAuditLog({
    organizationId: document.organizationId,
    actorUserId: ctx.userId,
    action: "admin.document_reindex",
    entityType: "Document",
    entityId: document.id,
    metadata: { triggeredByPlatformAdmin: true },
  });

  return prisma.document.findUnique({ where: { id: documentId } });
}
