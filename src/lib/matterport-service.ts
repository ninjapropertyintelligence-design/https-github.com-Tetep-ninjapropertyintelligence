import { prisma } from "@/lib/prisma";
import { SessionContext, propertyScopeWhere } from "@/lib/tenant-scope";
import { getMatterportProvider } from "@/lib/integrations/matterport-provider";
import { encryptSecret } from "@/lib/integrations/crypto";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { writeAuditLog } from "@/lib/audit";
import { recalculatePropertyHealth } from "@/lib/scoring";
import { ApiError } from "@/lib/api-error";
import { logEvent } from "@/lib/observability";

/**
 * Ties the InteriorCaptureProvider abstraction to the domain model. The
 * relationship is always Property -> MatterportPropertyLink ->
 * MatterportSpace (spec Phase 2 §2) — Matterport is never the source of
 * truth for the Property record itself, and disconnecting only removes the
 * link, never the Property or its history.
 */

export async function getOrgMatterportStatus(organizationId: string) {
  const provider = getMatterportProvider();
  const connection = await prisma.matterportConnection.findUnique({ where: { organizationId } });
  return {
    providerConfigured: provider.isConfigured(),
    connection,
  };
}

/** Org-level connect (spec §2: "connect Matterport account/configuration"). Requires canManageIntegrations. */
export async function connectMatterportForOrg(ctx: SessionContext) {
  const provider = getMatterportProvider();
  if (!provider.isConfigured()) {
    const connection = await prisma.matterportConnection.upsert({
      where: { organizationId: ctx.organizationId },
      create: { organizationId: ctx.organizationId, status: "NOT_CONFIGURED" },
      update: { status: "NOT_CONFIGURED", errorMessage: null },
    });
    return connection;
  }

  const result = await provider.connect();
  const connection = await prisma.matterportConnection.upsert({
    where: { organizationId: ctx.organizationId },
    create: {
      organizationId: ctx.organizationId,
      status: result.status,
      errorMessage: result.errorMessage ?? null,
      accessTokenEnc: encryptSecret(process.env.MATTERPORT_API_TOKEN ?? ""),
      lastSyncedAt: result.status === "CONNECTED" ? new Date() : null,
    },
    update: {
      status: result.status,
      errorMessage: result.errorMessage ?? null,
      lastSyncedAt: result.status === "CONNECTED" ? new Date() : undefined,
    },
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "matterport.connect_attempted",
    metadata: { status: result.status, errorMessage: result.errorMessage },
  });

  return connection;
}

export async function disconnectMatterportForOrg(ctx: SessionContext) {
  const provider = getMatterportProvider();
  await provider.disconnect();
  const connection = await prisma.matterportConnection.update({
    where: { organizationId: ctx.organizationId },
    data: { status: "DISCONNECTED", errorMessage: null },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "matterport.disconnected",
  });
  return connection;
}

export async function listAvailableSpaces(ctx: SessionContext) {
  const connection = await prisma.matterportConnection.findUnique({ where: { organizationId: ctx.organizationId } });
  if (!connection || connection.status !== "CONNECTED") {
    throw new ApiError(400, "Matterport is not connected for this organization");
  }
  const provider = getMatterportProvider();
  return provider.listSpaces();
}

async function assertPropertyInScope(ctx: SessionContext, propertyId: string) {
  const property = await prisma.property.findFirst({ where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] } });
  if (!property) throw new ApiError(404, "Property not found");
  return property;
}

/** Link a Matterport Space to a Property (spec §2: "link Matterport Space to a Property"). */
export async function linkSpaceToProperty(ctx: SessionContext, propertyId: string, externalSpaceId: string) {
  const property = await assertPropertyInScope(ctx, propertyId);

  const connection = await prisma.matterportConnection.findUnique({ where: { organizationId: ctx.organizationId } });
  if (!connection || connection.status !== "CONNECTED") {
    throw new ApiError(400, "Matterport is not connected for this organization");
  }

  const provider = getMatterportProvider();
  const remoteSpace = await provider.getSpace(externalSpaceId);
  if (!remoteSpace) throw new ApiError(404, "Matterport space not found");

  const space = await prisma.matterportSpace.upsert({
    where: { connectionId_externalSpaceId: { connectionId: connection.id, externalSpaceId } },
    create: {
      connectionId: connection.id,
      externalSpaceId,
      name: remoteSpace.name,
      status: remoteSpace.status,
      capturedAt: remoteSpace.capturedAt,
      syncedAt: new Date(),
    },
    update: { name: remoteSpace.name, status: remoteSpace.status, syncedAt: new Date() },
  });

  const link = await prisma.matterportPropertyLink.upsert({
    where: { propertyId_spaceId: { propertyId: property.id, spaceId: space.id } },
    create: { propertyId: property.id, spaceId: space.id, operator: ctx.userName },
    update: {},
    include: { space: true },
  });

  await Promise.all([
    emitEvent({
      organizationId: ctx.organizationId,
      propertyId: property.id,
      type: EVENT_TYPES.CAPTURE_CREATED,
      actorUserId: ctx.userId,
      payload: { provider: "matterport", externalSpaceId },
    }),
    writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "matterport.space_linked",
      entityType: "Property",
      entityId: property.id,
      metadata: { externalSpaceId },
    }),
    recalculatePropertyHealth(property.id),
  ]);

  return link;
}

/** Re-sync a property's linked Matterport space metadata. */
export async function syncPropertyInterior(ctx: SessionContext, propertyId: string) {
  const property = await assertPropertyInScope(ctx, propertyId);
  const link = await prisma.matterportPropertyLink.findFirst({
    where: { propertyId: property.id },
    orderBy: { linkedAt: "desc" },
    include: { space: true },
  });
  if (!link) throw new ApiError(404, "No Matterport space linked to this property");

  const provider = getMatterportProvider();
  const syncStartedAt = Date.now();
  try {
    const remoteSpace = await provider.syncSpace(link.space.externalSpaceId);
    const space = await prisma.matterportSpace.update({
      where: { id: link.space.id },
      data: {
        name: remoteSpace?.name ?? link.space.name,
        status: remoteSpace?.status ?? "ERROR",
        syncedAt: new Date(),
      },
    });
    logEvent("matterport.sync", {
      ok: true,
      organizationId: ctx.organizationId,
      propertyId: property.id,
      durationMs: Date.now() - syncStartedAt,
    });
    await Promise.all([
      emitEvent({
        organizationId: ctx.organizationId,
        propertyId: property.id,
        type: EVENT_TYPES.CAPTURE_PROCESSING_COMPLETED,
        actorUserId: ctx.userId,
        payload: { provider: "matterport", externalSpaceId: link.space.externalSpaceId },
      }),
      recalculatePropertyHealth(property.id),
    ]);
    return space;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logEvent("matterport.sync", {
      ok: false,
      organizationId: ctx.organizationId,
      propertyId: property.id,
      durationMs: Date.now() - syncStartedAt,
      errorMessage,
    });
    await emitEvent({
      organizationId: ctx.organizationId,
      propertyId: property.id,
      type: EVENT_TYPES.CAPTURE_PROCESSING_FAILED,
      actorUserId: ctx.userId,
      payload: { provider: "matterport", error: errorMessage },
    });
    throw new ApiError(502, errorMessage || "Matterport sync failed");
  }
}

/** Disconnect a property's interior capture — removes the link only, never the Property. */
export async function disconnectPropertyInterior(ctx: SessionContext, propertyId: string) {
  const property = await assertPropertyInScope(ctx, propertyId);
  const link = await prisma.matterportPropertyLink.findFirst({ where: { propertyId: property.id } });
  if (!link) throw new ApiError(404, "No Matterport space linked to this property");

  await prisma.matterportPropertyLink.delete({ where: { id: link.id } });

  await Promise.all([
    writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "matterport.property_disconnected",
      entityType: "Property",
      entityId: property.id,
    }),
    recalculatePropertyHealth(property.id),
  ]);
}

/** Full Interior tab data: org connection status + this property's linked space + viewer config + side-panel content. */
export async function getPropertyInteriorStatus(ctx: SessionContext, propertyId: string) {
  const property = await assertPropertyInScope(ctx, propertyId);
  const [connection, link] = await Promise.all([
    prisma.matterportConnection.findUnique({ where: { organizationId: ctx.organizationId } }),
    prisma.matterportPropertyLink.findFirst({
      where: { propertyId: property.id },
      orderBy: { linkedAt: "desc" },
      include: { space: true, references: { include: { asset: { select: { id: true, name: true } } } } },
    }),
  ]);

  const provider = getMatterportProvider();
  const viewerConfig = link ? provider.getViewerConfig(link.space.externalSpaceId) : null;

  const [areas, assets, issues, evidence] = property
    ? await Promise.all([
        prisma.area.findMany({ where: { floor: { building: { propertyId: property.id } } }, take: 50 }),
        prisma.asset.findMany({ where: { propertyId: property.id, status: "ACTIVE" }, take: 50, select: { id: true, name: true, assetType: true } }),
        prisma.issue.findMany({
          where: { propertyId: property.id, status: { in: ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"] } },
          take: 50,
          select: { id: true, title: true, severity: true },
        }),
        prisma.evidence.findMany({ where: { propertyId: property.id, type: { in: ["MATTERPORT_REFERENCE", "PHOTO", "IMAGE_360"] } }, take: 50 }),
      ])
    : [[], [], [], []];

  return {
    providerConfigured: provider.isConfigured(),
    connectionStatus: connection?.status ?? "NOT_CONFIGURED",
    connectionError: connection?.errorMessage ?? null,
    lastSync: connection?.lastSyncedAt ?? null,
    link: link
      ? {
          id: link.id,
          linkedAt: link.linkedAt,
          operator: link.operator,
          space: link.space,
          references: link.references,
          viewerConfig,
        }
      : null,
    sidePanel: { areas, assets, issues, evidence },
  };
}
