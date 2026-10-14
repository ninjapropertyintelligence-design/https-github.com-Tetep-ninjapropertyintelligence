import { prisma } from "@/lib/prisma";
import { Prisma, StorageObjectKind, type DroneOutputType } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api-error";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { FEATURE_FLAGS, isFeatureEnabled, requireFeature } from "@/lib/feature-flags";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import { DroneDeployApiError, DroneDeployClient, type DroneDeployPlan } from "@/lib/integrations/dronedeploy-client";
import { getStorageProvider, newObjectKey } from "@/lib/storage";
import { registerStorageObjectBestEffort } from "@/lib/storage-tiering";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { writeAuditLog } from "@/lib/audit";
import { recalculatePropertyHealth } from "@/lib/scoring";
import { logEvent } from "@/lib/observability";

/**
 * DRONEDEPLOY AUTO-IMPORT.
 *
 * Replaces "download the map from DroneDeploy, upload it here, pick the
 * property" with a background pass that does all three:
 *
 *   1. List the account's maps. Each one newer than `importSince` gets a
 *      DroneDeployImport row, once — the (organization, plan) unique key is
 *      what makes a re-run a no-op.
 *   2. File it to a property by GPS: the one property within
 *      `matchRadiusMeters` of the map's location. Zero candidates, or more
 *      than one, leaves it UNMATCHED for a person to choose — a map filed to
 *      the wrong building is worse than one waiting in a queue.
 *   3. A filed map becomes an ordinary DroneCapture + DroneDataset, and each
 *      configured layer is requested as a DroneDeploy export.
 *   4. Later passes check those exports; a COMPLETE one is streamed into our
 *      storage and registered as a DroneOutput. When every layer has landed
 *      the capture goes READY, exactly as a manual upload's does.
 *
 * Every step is resumable from the rows alone, so the runner can be called
 * on any schedule — or by hand — and a crash mid-pass loses nothing.
 *
 * Entitlement follows drone-service: DRONE_PROCESSING gates bringing data in
 * (connecting, importing). Status reads and disconnecting are never gated.
 */

/** DroneDeploy layer name -> what we store it as. */
export const EXPORT_LAYERS: Record<string, DroneOutputType> = {
  ORTHOMOSAIC: "ORTHOMOSAIC",
  ELEVATION: "DSM",
  POINT_CLOUD: "POINT_CLOUD",
};

/**
 * Which layers to pull. Orthomosaic only by default: it is what the Exterior
 * tab shows, and point clouds run to gigabytes per flight — storage the
 * customer pays for. `DRONEDEPLOY_EXPORT_LAYERS=ORTHOMOSAIC,ELEVATION,POINT_CLOUD`
 * widens it.
 */
export function configuredLayers(): string[] {
  const raw = process.env.DRONEDEPLOY_EXPORT_LAYERS ?? "ORTHOMOSAIC";
  const layers = raw
    .split(",")
    .map((l) => l.trim().toUpperCase())
    .filter((l) => l in EXPORT_LAYERS);
  return layers.length > 0 ? [...new Set(layers)] : ["ORTHOMOSAIC"];
}

/** Failed attempts at one export before it is given up on. Still-processing checks do not count. */
export const MAX_EXPORT_ATTEMPTS = 5;

/**
 * Copies per organization per pass. A copy streams a file that can be
 * gigabytes, and one pass has to fit in one function invocation; the rest
 * wait for the next pass rather than all racing the timeout.
 */
const MAX_COPIES_PER_RUN = 3;

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/** What a client may see of a connection: everything except the key. */
function publicConnection(c: {
  status: string;
  errorMessage: string | null;
  importSince: Date;
  matchRadiusMeters: number;
  lastPolledAt: Date | null;
  createdAt: Date;
}) {
  return {
    status: c.status,
    errorMessage: c.errorMessage,
    importSince: c.importSince,
    matchRadiusMeters: c.matchRadiusMeters,
    lastPolledAt: c.lastPolledAt,
    connectedAt: c.createdAt,
  };
}

/**
 * Connects this organization's own DroneDeploy account.
 *
 * Unlike Matterport the key is per organization, not platform env: each
 * customer's maps live in their own DroneDeploy account, and one shared key
 * would make every customer's flights candidates for every other customer.
 * The key is verified before it is stored, so "connected" means it worked.
 */
export async function connectDroneDeploy(ctx: SessionContext, apiKey: string) {
  await requireFeature(ctx, FEATURE_FLAGS.DRONE_PROCESSING);
  const key = apiKey.trim();
  if (!key) throw new ApiError(400, "An API key is required");

  let username: string | null;
  try {
    ({ username } = await new DroneDeployClient(key).verify());
  } catch (err) {
    if (err instanceof DroneDeployApiError && err.unauthorized) {
      throw new ApiError(400, "DroneDeploy rejected that API key");
    }
    throw new ApiError(502, `Could not reach DroneDeploy: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  const connection = await prisma.droneDeployConnection.upsert({
    where: { organizationId: ctx.organizationId },
    // importSince is set on first connect only. Replacing a key must not
    // move the cut-off forward and silently skip maps flown in between.
    create: { organizationId: ctx.organizationId, apiKeyEnc: encryptSecret(key) },
    update: { apiKeyEnc: encryptSecret(key), status: "CONNECTED", errorMessage: null },
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "dronedeploy.connected",
    metadata: { dronedeployUser: username },
  });

  return publicConnection(connection);
}

/** Forgets the key. Imported captures stay — they are this customer's data. */
export async function disconnectDroneDeploy(ctx: SessionContext) {
  const deleted = await prisma.droneDeployConnection.deleteMany({ where: { organizationId: ctx.organizationId } });
  if (deleted.count === 0) throw new ApiError(404, "DroneDeploy is not connected");
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "dronedeploy.disconnected",
  });
}

export async function updateDroneDeploySettings(
  ctx: SessionContext,
  input: { matchRadiusMeters?: number; importSince?: Date },
) {
  const existing = await prisma.droneDeployConnection.findUnique({ where: { organizationId: ctx.organizationId } });
  if (!existing) throw new ApiError(404, "DroneDeploy is not connected");
  const connection = await prisma.droneDeployConnection.update({
    where: { id: existing.id },
    data: {
      ...(input.matchRadiusMeters !== undefined ? { matchRadiusMeters: input.matchRadiusMeters } : {}),
      ...(input.importSince !== undefined ? { importSince: input.importSince } : {}),
    },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "dronedeploy.settings_updated",
    metadata: { matchRadiusMeters: input.matchRadiusMeters, importSince: input.importSince?.toISOString() },
  });
  return publicConnection(connection);
}

/** Connection state plus the import queue, for the settings screen. */
export async function getDroneDeployStatus(ctx: SessionContext) {
  const [connection, imports, entitled] = await Promise.all([
    prisma.droneDeployConnection.findUnique({ where: { organizationId: ctx.organizationId } }),
    prisma.droneDeployImport.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ planCreatedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
      include: {
        property: { select: { id: true, name: true } },
        exports: { select: { layer: true, status: true, errorMessage: true } },
      },
    }),
    isFeatureEnabled(ctx.organizationId || null, FEATURE_FLAGS.DRONE_PROCESSING),
  ]);
  return {
    entitled,
    layers: configuredLayers(),
    connection: connection ? publicConnection(connection) : null,
    imports,
  };
}

// ---------------------------------------------------------------------------
// Matching and filing
// ---------------------------------------------------------------------------

export type PropertyMatch =
  | { kind: "MATCHED"; propertyId: string; distanceMeters: number }
  | { kind: "NONE" }
  | { kind: "AMBIGUOUS"; count: number }
  | { kind: "NO_LOCATION" };

/**
 * The single property within `radiusMeters` of a point, in one organization.
 *
 * Raw SQL for the same reason as spatial.ts (Prisma has no geography type),
 * filtered by organizationId — the tenant boundary. There is no session here
 * to apply a narrower scope from: this runs as the system, and an org-wide
 * match is what filing an org's own map means.
 */
export async function matchPropertyByLocation(
  organizationId: string,
  latitude: number | null,
  longitude: number | null,
  radiusMeters: number,
): Promise<PropertyMatch> {
  if (latitude === null || longitude === null) return { kind: "NO_LOCATION" };
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { kind: "NO_LOCATION" };
  const point = `SRID=4326;POINT(${longitude} ${latitude})`;
  const rows = await prisma.$queryRaw<Array<{ id: string; distance_meters: number }>>(
    Prisma.sql`
      SELECT id, ST_Distance("geo", ${point}::geography) AS distance_meters
      FROM "Property"
      WHERE "organizationId" = ${organizationId}
        AND "geo" IS NOT NULL
        AND ST_DWithin("geo", ${point}::geography, ${radiusMeters})
      ORDER BY "geo" <-> ${point}::geography
      LIMIT 2
    `,
  );
  if (rows.length === 0) return { kind: "NONE" };
  if (rows.length > 1) return { kind: "AMBIGUOUS", count: rows.length };
  return { kind: "MATCHED", propertyId: rows[0].id, distanceMeters: Number(rows[0].distance_meters) };
}

function unmatchedReason(match: PropertyMatch, radiusMeters: number): string | null {
  switch (match.kind) {
    case "NO_LOCATION":
      return "DroneDeploy gave no location for this map";
    case "NONE":
      return `No property within ${radiusMeters} m of this map`;
    case "AMBIGUOUS":
      return `More than one property within ${radiusMeters} m — choose which one`;
    default:
      return null;
  }
}

/**
 * Turns an import into a DroneCapture on a property and queues its layers.
 * Conditional on the import still being unfiled, so two passes (or a pass and
 * a person) racing on the same map file it once.
 */
async function fileImport(
  importId: string,
  propertyId: string,
  how: { matchedBy: "GPS" | "MANUAL"; distanceMeters: number | null; actorUserId: string | null },
) {
  const imp = await prisma.droneDeployImport.findUnique({ where: { id: importId } });
  if (!imp) throw new ApiError(404, "Import not found");

  const filed = await prisma.$transaction(async (tx) => {
    const claimed = await tx.droneDeployImport.updateMany({
      where: { id: imp.id, captureId: null, status: { in: ["UNMATCHED", "IGNORED"] } },
      data: { status: "IMPORTING" },
    });
    if (claimed.count === 0) return null;

    const capture = await tx.droneCapture.create({
      data: {
        propertyId,
        capturedById: how.actorUserId,
        capturedAt: imp.planCreatedAt,
        status: "PROCESSING",
        notes: `Imported from DroneDeploy${imp.planName ? `: ${imp.planName}` : ""}`,
        datasets: { create: { provider: "DRONEDEPLOY", externalJobId: imp.externalPlanId } },
      },
    });
    await tx.droneDeployImport.update({
      where: { id: imp.id },
      data: {
        propertyId,
        captureId: capture.id,
        matchedBy: how.matchedBy,
        matchDistanceMeters: how.distanceMeters,
        errorMessage: null,
      },
    });
    await tx.droneDeployExportImport.createMany({
      data: configuredLayers().map((layer) => ({ importId: imp.id, layer, outputType: EXPORT_LAYERS[layer] })),
      skipDuplicates: true,
    });
    return capture;
  });
  if (!filed) return null;

  await emitEvent({
    organizationId: imp.organizationId,
    propertyId,
    type: EVENT_TYPES.CAPTURE_CREATED,
    actorUserId: how.actorUserId,
    payload: { captureId: filed.id, provider: "dronedeploy", planId: imp.externalPlanId, matchedBy: how.matchedBy },
  });
  return filed;
}

async function loadScopedImport(ctx: SessionContext, importId: string) {
  const imp = await prisma.droneDeployImport.findFirst({ where: { id: importId, organizationId: ctx.organizationId } });
  if (!imp) throw new ApiError(404, "Import not found");
  return imp;
}

/** A person files an unmatched (or previously ignored) map to a property. */
export async function assignDroneDeployImport(ctx: SessionContext, importId: string, propertyId: string) {
  await requireFeature(ctx, FEATURE_FLAGS.DRONE_PROCESSING);
  const imp = await loadScopedImport(ctx, importId);
  if (imp.status !== "UNMATCHED" && imp.status !== "IGNORED") {
    throw new ApiError(409, "This map has already been filed to a property");
  }
  const property = await prisma.property.findFirst({ where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] } });
  if (!property) throw new ApiError(400, "Invalid propertyId, or you don't have access to it");

  const capture = await fileImport(imp.id, property.id, { matchedBy: "MANUAL", distanceMeters: null, actorUserId: ctx.userId });
  if (!capture) throw new ApiError(409, "This map has already been filed to a property");

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "dronedeploy.import_assigned",
    entityType: "DroneDeployImport",
    entityId: imp.id,
    metadata: { propertyId: property.id, planId: imp.externalPlanId },
  });
  return prisma.droneDeployImport.findUniqueOrThrow({ where: { id: imp.id } });
}

/** A person says this map does not belong here. Reversible by assigning it. */
export async function ignoreDroneDeployImport(ctx: SessionContext, importId: string) {
  const imp = await loadScopedImport(ctx, importId);
  if (imp.status !== "UNMATCHED") throw new ApiError(409, "Only an unmatched map can be ignored");
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "dronedeploy.import_ignored",
    entityType: "DroneDeployImport",
    entityId: imp.id,
  });
  return prisma.droneDeployImport.update({ where: { id: imp.id }, data: { status: "IGNORED" } });
}

/** Puts a failed import's failed layers back in the queue. */
export async function retryDroneDeployImport(ctx: SessionContext, importId: string) {
  await requireFeature(ctx, FEATURE_FLAGS.DRONE_PROCESSING);
  const imp = await loadScopedImport(ctx, importId);
  if (imp.status !== "FAILED" || !imp.captureId) throw new ApiError(409, "Only a failed import can be retried");
  await prisma.$transaction([
    prisma.droneDeployExportImport.updateMany({
      where: { importId: imp.id, status: "FAILED" },
      data: { status: "REQUESTED", externalExportId: null, attempts: 0, errorMessage: null },
    }),
    prisma.droneDeployImport.update({ where: { id: imp.id }, data: { status: "IMPORTING", errorMessage: null } }),
    prisma.droneCapture.update({ where: { id: imp.captureId }, data: { status: "PROCESSING" } }),
  ]);
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "dronedeploy.import_retried",
    entityType: "DroneDeployImport",
    entityId: imp.id,
  });
  return prisma.droneDeployImport.findUniqueOrThrow({ where: { id: imp.id } });
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

export interface DroneDeployRunResult {
  organizationId: string;
  skipped?: string;
  newMaps: number;
  autoMatched: number;
  unmatched: number;
  skippedUndated: number;
  exportsRequested: number;
  exportsImported: number;
  exportsFailed: number;
  capturesCompleted: number;
  error?: string;
}

/**
 * One pass over one organization. Safe to call at any time and any number
 * of times: every step is guarded by the state in the rows.
 */
export async function runDroneDeployImportForOrganization(organizationId: string): Promise<DroneDeployRunResult> {
  const result: DroneDeployRunResult = {
    organizationId,
    newMaps: 0,
    autoMatched: 0,
    unmatched: 0,
    skippedUndated: 0,
    exportsRequested: 0,
    exportsImported: 0,
    exportsFailed: 0,
    capturesCompleted: 0,
  };
  const startedAt = Date.now();

  const connection = await prisma.droneDeployConnection.findUnique({ where: { organizationId } });
  if (!connection) return { ...result, skipped: "not connected" };
  if (!(await isFeatureEnabled(organizationId, FEATURE_FLAGS.DRONE_PROCESSING))) {
    return { ...result, skipped: "drone capture is not enabled for this organization" };
  }

  const client = new DroneDeployClient(decryptSecret(connection.apiKeyEnc));

  // 1-2. Discover and file new maps. A listing failure does not stop step 3:
  // exports already requested can still be collected.
  let listingError: string | null = null;
  try {
    const plans = await client.listPlans();
    for (const plan of plans) {
      await discoverPlan(connection, plan, result);
    }
  } catch (err) {
    listingError = err instanceof Error ? err.message : String(err);
    if (err instanceof DroneDeployApiError && err.unauthorized) {
      // A dead key fails every call; stop here and say so on the connection.
      await prisma.droneDeployConnection.update({
        where: { id: connection.id },
        data: { status: "ERROR", errorMessage: listingError, lastPolledAt: new Date() },
      });
      logEvent("dronedeploy.import_run", { ok: false, organizationId, durationMs: Date.now() - startedAt, errorMessage: listingError });
      return { ...result, error: listingError };
    }
  }

  // 3-4. Advance everything in flight.
  const budget = { copies: MAX_COPIES_PER_RUN };
  const inFlight = await prisma.droneDeployImport.findMany({
    where: { organizationId, status: "IMPORTING" },
    orderBy: { createdAt: "asc" },
    include: { exports: true, capture: { include: { datasets: { select: { id: true }, take: 1 } } } },
  });
  for (const imp of inFlight) {
    await advanceImport(client, imp, budget, result);
  }

  await prisma.droneDeployConnection.update({
    where: { id: connection.id },
    data: {
      lastPolledAt: new Date(),
      status: listingError ? "ERROR" : "CONNECTED",
      errorMessage: listingError,
    },
  });

  logEvent("dronedeploy.import_run", {
    ok: !listingError,
    organizationId,
    durationMs: Date.now() - startedAt,
    errorMessage: listingError ?? undefined,
    newMaps: result.newMaps,
    exportsImported: result.exportsImported,
  });
  return listingError ? { ...result, error: listingError } : result;
}

async function discoverPlan(
  connection: { organizationId: string; importSince: Date; matchRadiusMeters: number },
  plan: DroneDeployPlan,
  result: DroneDeployRunResult,
) {
  // An undated map cannot be placed against the cut-off. Skipping it errs on
  // the side of not copying data nobody asked for; it is counted so the
  // number is visible rather than silently zero.
  if (!plan.createdAt) {
    result.skippedUndated++;
    return;
  }
  if (plan.createdAt < connection.importSince) return;

  const existing = await prisma.droneDeployImport.findUnique({
    where: { organizationId_externalPlanId: { organizationId: connection.organizationId, externalPlanId: plan.id } },
    select: { id: true },
  });
  if (existing) return;

  const match = await matchPropertyByLocation(
    connection.organizationId,
    plan.latitude,
    plan.longitude,
    connection.matchRadiusMeters,
  );

  let created;
  try {
    created = await prisma.droneDeployImport.create({
      data: {
        organizationId: connection.organizationId,
        externalPlanId: plan.id,
        planName: plan.name,
        planCreatedAt: plan.createdAt,
        latitude: plan.latitude,
        longitude: plan.longitude,
        status: "UNMATCHED",
        errorMessage: unmatchedReason(match, connection.matchRadiusMeters),
      },
    });
  } catch (err) {
    // A concurrent pass inserted it first; that pass owns it.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    throw err;
  }
  result.newMaps++;

  if (match.kind === "MATCHED") {
    await fileImport(created.id, match.propertyId, {
      matchedBy: "GPS",
      distanceMeters: match.distanceMeters,
      actorUserId: null,
    });
    result.autoMatched++;
  } else {
    result.unmatched++;
  }
}

type InFlightImport = Prisma.DroneDeployImportGetPayload<{
  include: { exports: true; capture: { include: { datasets: { select: { id: true } } } } };
}>;

async function advanceImport(
  client: DroneDeployClient,
  imp: InFlightImport,
  budget: { copies: number },
  result: DroneDeployRunResult,
) {
  const datasetId = imp.capture?.datasets[0]?.id;
  if (!imp.capture || !datasetId || !imp.propertyId) {
    // The capture was deleted out from under the import.
    await prisma.droneDeployImport.update({
      where: { id: imp.id },
      data: { status: "FAILED", errorMessage: "The capture this map was imported into no longer exists" },
    });
    return;
  }

  for (const exp of imp.exports) {
    if (exp.status !== "REQUESTED") continue;
    try {
      if (!exp.externalExportId) {
        const { exportId } = await client.createExport(imp.externalPlanId, exp.layer);
        await prisma.droneDeployExportImport.update({
          where: { id: exp.id },
          data: { externalExportId: exportId, errorMessage: null },
        });
        result.exportsRequested++;
        continue; // DroneDeploy takes minutes to build it; check on a later pass.
      }

      const state = await client.getExport(exp.externalExportId);
      if (state.state === "PENDING") continue;
      if (state.state === "FAILED") {
        await prisma.droneDeployExportImport.update({
          where: { id: exp.id },
          data: { status: "FAILED", errorMessage: state.reason },
        });
        result.exportsFailed++;
        continue;
      }
      if (budget.copies <= 0) continue;
      budget.copies--;

      const output = await copyExportToStorage({
        organizationId: imp.organizationId,
        propertyId: imp.propertyId,
        datasetId,
        downloadUrl: state.downloadUrl,
        outputType: exp.outputType,
        metadata: { source: "dronedeploy", planId: imp.externalPlanId, exportId: exp.externalExportId, layer: exp.layer },
      });
      await prisma.droneDeployExportImport.update({
        where: { id: exp.id },
        data: { status: "IMPORTED", droneOutputId: output.id, errorMessage: null },
      });
      result.exportsImported++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = exp.attempts + 1;
      const giveUp = attempts >= MAX_EXPORT_ATTEMPTS;
      await prisma.droneDeployExportImport.update({
        where: { id: exp.id },
        data: { attempts, errorMessage: message, ...(giveUp ? { status: "FAILED" } : {}) },
      });
      if (giveUp) result.exportsFailed++;
      // A rejected key will fail every remaining call the same way.
      if (err instanceof DroneDeployApiError && err.unauthorized) break;
    }
  }

  await settleImport(imp.id, result);
}

/** Once no layer is still REQUESTED, the capture is finished one way or the other. */
async function settleImport(importId: string, result: DroneDeployRunResult) {
  const imp = await prisma.droneDeployImport.findUniqueOrThrow({ where: { id: importId }, include: { exports: true } });
  if (imp.status !== "IMPORTING" || !imp.captureId || !imp.propertyId) return;
  if (imp.exports.some((e) => e.status === "REQUESTED")) return;

  const imported = imp.exports.filter((e) => e.status === "IMPORTED").length;
  if (imported > 0) {
    await prisma.$transaction([
      prisma.droneCapture.update({ where: { id: imp.captureId }, data: { status: "READY" } }),
      prisma.droneDeployImport.update({ where: { id: imp.id }, data: { status: "IMPORTED", errorMessage: null } }),
    ]);
    await Promise.all([
      emitEvent({
        organizationId: imp.organizationId,
        propertyId: imp.propertyId,
        type: EVENT_TYPES.CAPTURE_PROCESSING_COMPLETED,
        payload: { captureId: imp.captureId, provider: "dronedeploy", layersImported: imported },
      }),
      recalculatePropertyHealth(imp.propertyId),
    ]);
    result.capturesCompleted++;
    return;
  }

  const reason = imp.exports.map((e) => `${e.layer}: ${e.errorMessage ?? "failed"}`).join("; ");
  await prisma.$transaction([
    prisma.droneCapture.update({ where: { id: imp.captureId }, data: { status: "FAILED" } }),
    prisma.droneDeployImport.update({ where: { id: imp.id }, data: { status: "FAILED", errorMessage: reason } }),
  ]);
  await emitEvent({
    organizationId: imp.organizationId,
    propertyId: imp.propertyId,
    type: EVENT_TYPES.CAPTURE_PROCESSING_FAILED,
    payload: { captureId: imp.captureId, provider: "dronedeploy", error: reason },
  });
}

/** The filename DroneDeploy sent, from Content-Disposition or the URL path. */
export function filenameFromResponse(res: Response, url: string, fallback: string): string {
  const disposition = res.headers.get("content-disposition") ?? "";
  const star = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  const fromHeader = star ? decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")) : plain?.[1]?.trim();
  if (fromHeader) return fromHeader.split(/[\\/]/).pop() || fallback;
  try {
    const last = new URL(url).pathname.split("/").pop();
    if (last && last.includes(".")) return decodeURIComponent(last);
  } catch {
    // fall through
  }
  return fallback;
}

/**
 * Streams one finished export from DroneDeploy into our store and registers
 * it as a DroneOutput. Never buffers the file — see StorageProvider.writeStream.
 *
 * The extension allow-list that guards manual uploads is not applied: those
 * lists protect against a person picking the wrong file, and here the file
 * is whatever DroneDeploy built for the layer we asked for, often a .zip. The
 * original filename is recorded so the Exterior tab can tell an archive from
 * a raster.
 */
async function copyExportToStorage(params: {
  organizationId: string;
  propertyId: string;
  datasetId: string;
  downloadUrl: string;
  outputType: DroneOutputType;
  metadata: Record<string, unknown>;
}) {
  const startedAt = Date.now();
  let parsed: URL;
  try {
    parsed = new URL(params.downloadUrl);
  } catch {
    throw new Error("DroneDeploy returned an invalid download URL");
  }
  if (parsed.protocol !== "https:") throw new Error("Refusing a non-HTTPS download URL");

  const res = await fetch(parsed, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Downloading the export failed (HTTP ${res.status})`);
  const length = Number(res.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0) {
    // An S3 PUT must declare its size before the first byte, so a download
    // that does not say how big it is cannot be streamed into the store.
    await res.body.cancel().catch(() => {});
    throw new Error("The export download did not report its size");
  }

  const filename = filenameFromResponse(res, params.downloadUrl, `${params.outputType.toLowerCase()}.bin`);
  const storage = getStorageProvider();
  const key = newObjectKey(params.organizationId, filename);
  await storage.writeStream(key, res.body, length);

  const verification = await storage.verifyUpload(key);
  if (!verification.exists || (verification.actualSizeBytes !== null && verification.actualSizeBytes !== length)) {
    await storage.delete(key).catch(() => {});
    throw new Error(
      `Copied export is ${verification.actualSizeBytes ?? "missing"} bytes, expected ${length} — the transfer was cut short`,
    );
  }

  const output = await prisma.droneOutput.create({
    data: {
      datasetId: params.datasetId,
      outputType: params.outputType,
      storageKey: key,
      mimeType: res.headers.get("content-type"),
      sizeBytes: verification.actualSizeBytes ?? length,
      checksum: verification.actualChecksumSha256,
      metadata: {
        ...params.metadata,
        originalFilename: filename,
        archive: filename.toLowerCase().endsWith(".zip"),
      } as Prisma.InputJsonValue,
    },
  });

  await registerStorageObjectBestEffort({
    organizationId: params.organizationId,
    storageKey: output.storageKey,
    kind: StorageObjectKind.DRONE_OUTPUT,
    sizeBytes: output.sizeBytes === null ? null : Number(output.sizeBytes),
    objectCreatedAt: output.createdAt,
  });

  logEvent("dronedeploy.export_copy", {
    ok: true,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    sizeBytes: length,
    durationMs: Date.now() - startedAt,
  });
  return output;
}

/** Every connected organization, one after another. Used by the cron and admin runners. */
export async function runDueDroneDeployImports(): Promise<DroneDeployRunResult[]> {
  const connections = await prisma.droneDeployConnection.findMany({ select: { organizationId: true } });
  const results: DroneDeployRunResult[] = [];
  for (const { organizationId } of connections) {
    try {
      results.push(await runDroneDeployImportForOrganization(organizationId));
    } catch (err) {
      // One organization's failure must not stop everyone else's import.
      results.push({
        organizationId,
        newMaps: 0,
        autoMatched: 0,
        unmatched: 0,
        skippedUndated: 0,
        exportsRequested: 0,
        exportsImported: 0,
        exportsFailed: 0,
        capturesCompleted: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
