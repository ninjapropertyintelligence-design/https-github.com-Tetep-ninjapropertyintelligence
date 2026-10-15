import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { CaptureJobSiteStatus, Role, VendorConnectionProvider } from "@/generated/prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import { DroneDeployApiError, DroneDeployClient } from "@/lib/integrations/dronedeploy-client";
import { MatterportProvider } from "@/lib/integrations/matterport-provider";
import { fileVendorDroneDeployMap, runVendorDroneDeployImports } from "@/lib/dronedeploy-import-service";
import { linkSpaceByIdDirect } from "@/lib/matterport-service";
import { getCaptureJob } from "@/lib/capture-job-service";
import { FEATURE_FLAGS, requireFeature } from "@/lib/feature-flags";
import { distanceMeters } from "@/lib/media/panorama-metadata";
import { writeAuditLog } from "@/lib/audit";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * A vendor company's own DroneDeploy and Matterport accounts.
 *
 * The vendor flies and scans with its own accounts. Connecting them here lets
 * its people pick a flight or a scan on a capture job instead of downloading
 * it and uploading it again. What they pick lands on the job site and is held
 * for the platform team's approval, the same as an upload.
 *
 * Credentials are checked against the provider before they are stored, are
 * stored encrypted, and are never returned to a browser.
 */

const OPEN_JOB = ["ISSUED", "SUBMITTED", "REJECTED"];

function requireVendor(ctx: SessionContext): string {
  if (ctx.role !== Role.VENDOR || !ctx.vendorId) {
    throw new ApiError(403, "Only a vendor can manage its own connections");
  }
  return ctx.vendorId;
}

export interface VendorConnectionStatus {
  provider: VendorConnectionProvider;
  connected: boolean;
  status: string | null;
  accountLabel: string | null;
  errorMessage: string | null;
  connectedAt: Date | null;
}

export async function listVendorConnections(ctx: SessionContext): Promise<VendorConnectionStatus[]> {
  const vendorId = requireVendor(ctx);
  const rows = await prisma.vendorConnection.findMany({ where: { vendorId } });
  return Object.values(VendorConnectionProvider).map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    return {
      provider,
      connected: !!row,
      status: row?.status ?? null,
      accountLabel: row?.accountLabel ?? null,
      errorMessage: row?.errorMessage ?? null,
      connectedAt: row?.createdAt ?? null,
    };
  });
}

async function saveConnection(
  ctx: SessionContext,
  vendorId: string,
  provider: VendorConnectionProvider,
  secret: string,
  accountLabel: string | null,
) {
  await prisma.vendorConnection.upsert({
    where: { vendorId_provider: { vendorId, provider } },
    create: {
      vendorId,
      provider,
      secretEnc: encryptSecret(secret),
      accountLabel,
      connectedById: ctx.userId,
    },
    update: {
      secretEnc: encryptSecret(secret),
      accountLabel,
      status: "CONNECTED",
      errorMessage: null,
      connectedById: ctx.userId,
    },
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "vendor_connection.connected",
    entityType: "Vendor",
    entityId: vendorId,
    metadata: { provider },
  });
}

/** Connects the vendor's DroneDeploy account with an API key, checked first. */
export async function connectVendorDroneDeploy(ctx: SessionContext, apiKey: string) {
  const vendorId = requireVendor(ctx);
  const key = apiKey.trim();
  if (!key) throw new ApiError(400, "Paste the DroneDeploy API key");
  let username: string | null;
  try {
    ({ username } = await new DroneDeployClient(key).verify());
  } catch (err) {
    throw new ApiError(
      400,
      err instanceof DroneDeployApiError && err.unauthorized
        ? "DroneDeploy did not accept that API key. Check it in DroneDeploy under Settings → API keys."
        : `Could not reach DroneDeploy to check the key: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await saveConnection(ctx, vendorId, VendorConnectionProvider.DRONEDEPLOY, key, username);
  return listVendorConnections(ctx);
}

interface MatterportSecret {
  tokenId: string;
  tokenSecret: string;
}

function matterportFor(secret: MatterportSecret) {
  return new MatterportProvider(secret.tokenId, secret.tokenSecret, process.env.MATTERPORT_SDK_KEY);
}

/** Connects the vendor's Matterport account with an API token, checked first. */
export async function connectVendorMatterport(ctx: SessionContext, tokenId: string, tokenSecret: string) {
  const vendorId = requireVendor(ctx);
  const secret = { tokenId: tokenId.trim(), tokenSecret: tokenSecret.trim() };
  if (!secret.tokenId || !secret.tokenSecret) throw new ApiError(400, "Paste both the token ID and the token secret");
  try {
    await matterportFor(secret).listSpaces();
  } catch (err) {
    throw new ApiError(
      400,
      `Matterport did not accept that token: ${err instanceof Error ? err.message : String(err)}. ` +
        "Create one in Matterport under Settings → Developer Tools → API Token Management.",
    );
  }
  await saveConnection(ctx, vendorId, VendorConnectionProvider.MATTERPORT, JSON.stringify(secret), null);
  return listVendorConnections(ctx);
}

export async function disconnectVendorConnection(ctx: SessionContext, provider: VendorConnectionProvider) {
  const vendorId = requireVendor(ctx);
  await prisma.vendorConnection.deleteMany({ where: { vendorId, provider } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "vendor_connection.disconnected",
    entityType: "Vendor",
    entityId: vendorId,
    metadata: { provider },
  });
  return listVendorConnections(ctx);
}

async function connectionFor(vendorId: string, provider: VendorConnectionProvider) {
  const row = await prisma.vendorConnection.findUnique({ where: { vendorId_provider: { vendorId, provider } } });
  if (!row) {
    throw new ApiError(
      400,
      `Connect your ${provider === "DRONEDEPLOY" ? "DroneDeploy" : "Matterport"} account first, under Connections.`,
    );
  }
  return row;
}

/** One of the vendor's own open job sites, still accepting work. */
async function openSite(ctx: SessionContext, jobId: string, siteId: string) {
  const job = await getCaptureJob(ctx, jobId);
  const site = job.sites.find((s) => s.id === siteId);
  if (!site) throw new ApiError(404, "Site not found on this capture job");
  if (!OPEN_JOB.includes(job.status) || site.status === CaptureJobSiteStatus.ACCEPTED) {
    throw new ApiError(409, "This site is no longer accepting work");
  }
  return { job, site };
}

/**
 * The vendor's DroneDeploy maps, nearest to the site first, so the right
 * flight is at the top. Maps already brought in are marked.
 */
export async function listVendorDroneDeployMaps(ctx: SessionContext, jobId: string, siteId: string) {
  const vendorId = requireVendor(ctx);
  const { site } = await openSite(ctx, jobId, siteId);
  const connection = await connectionFor(vendorId, VendorConnectionProvider.DRONEDEPLOY);
  let plans;
  try {
    plans = await new DroneDeployClient(decryptSecret(connection.secretEnc)).listPlans();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.vendorConnection.update({ where: { id: connection.id }, data: { status: "ERROR", errorMessage: message } });
    throw new ApiError(502, `DroneDeploy did not return your maps: ${message}`);
  }
  const imported = await prisma.droneDeployImport.findMany({
    where: { organizationId: ctx.organizationId, externalPlanId: { in: plans.map((p) => p.id) }, captureId: { not: null } },
    select: { externalPlanId: true },
  });
  const done = new Set(imported.map((i) => i.externalPlanId));
  const { latitude, longitude } = site.property;
  return plans
    .map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      distanceMeters:
        latitude !== null && longitude !== null && p.latitude !== null && p.longitude !== null
          ? Math.round(distanceMeters(latitude, longitude, p.latitude, p.longitude))
          : null,
      imported: done.has(p.id),
    }))
    .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
}

/** Brings one of the vendor's DroneDeploy maps onto the site, held for review. */
export async function importVendorDroneDeployMap(ctx: SessionContext, jobId: string, siteId: string, planId: string) {
  const vendorId = requireVendor(ctx);
  await requireFeature(ctx, FEATURE_FLAGS.DRONE_PROCESSING);
  const { site } = await openSite(ctx, jobId, siteId);
  const connection = await connectionFor(vendorId, VendorConnectionProvider.DRONEDEPLOY);
  // Only a map that is really in the vendor's account: the id comes from a
  // browser, and importing must never reach a map the vendor cannot see.
  const plans = await new DroneDeployClient(decryptSecret(connection.secretEnc)).listPlans();
  const plan = plans.find((p) => p.id === planId);
  if (!plan) throw new ApiError(404, "That map is not in your DroneDeploy account");

  const imp = await fileVendorDroneDeployMap({
    organizationId: ctx.organizationId,
    vendorConnectionId: connection.id,
    plan,
    propertyId: site.propertyId,
    captureJobSiteId: site.id,
    actorUserId: ctx.userId,
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "dronedeploy.vendor_map_imported",
    entityType: "CaptureJobSite",
    entityId: site.id,
    metadata: { planId, planName: plan.name },
  });
  // Ask DroneDeploy for the exports now rather than at the next scheduled pass.
  await runVendorDroneDeployImports({ importIds: [imp.id] }).catch(() => {});
  return listVendorDroneDeployImports(ctx, jobId, siteId);
}

/** What the vendor has brought in from DroneDeploy for this site, and how far along it is. */
export async function listVendorDroneDeployImports(ctx: SessionContext, jobId: string, siteId: string) {
  requireVendor(ctx);
  const { site } = await openSite(ctx, jobId, siteId);
  const rows = await prisma.droneDeployImport.findMany({
    where: { organizationId: ctx.organizationId, capture: { captureJobSiteId: site.id }, vendorConnectionId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      planName: true,
      status: true,
      errorMessage: true,
      exports: { select: { layer: true, status: true, errorMessage: true } },
    },
  });
  return rows;
}

/** Moves this site's vendor imports along now: copies whatever DroneDeploy has finished. */
export async function refreshVendorDroneDeployImports(ctx: SessionContext, jobId: string, siteId: string) {
  const before = await listVendorDroneDeployImports(ctx, jobId, siteId);
  const inFlight = before.filter((i) => i.status === "IMPORTING").map((i) => i.id);
  if (inFlight.length) await runVendorDroneDeployImports({ importIds: inFlight });
  return listVendorDroneDeployImports(ctx, jobId, siteId);
}

/** The scans in the vendor's Matterport account. */
export async function listVendorMatterportSpaces(ctx: SessionContext) {
  const vendorId = requireVendor(ctx);
  const connection = await connectionFor(vendorId, VendorConnectionProvider.MATTERPORT);
  const secret = JSON.parse(decryptSecret(connection.secretEnc)) as MatterportSecret;
  try {
    const spaces = await matterportFor(secret).listSpaces();
    return spaces.map((s) => ({ id: s.externalSpaceId, name: s.name }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.vendorConnection.update({ where: { id: connection.id }, data: { status: "ERROR", errorMessage: message } });
    throw new ApiError(502, `Matterport did not return your scans: ${message}`);
  }
}

/** Puts one of the vendor's Matterport scans on the site, held for review. */
export async function linkVendorMatterportSpace(ctx: SessionContext, jobId: string, siteId: string, spaceId: string) {
  requireVendor(ctx);
  const { site } = await openSite(ctx, jobId, siteId);
  const spaces = await listVendorMatterportSpaces(ctx);
  const space = spaces.find((s) => s.id === spaceId);
  if (!space) throw new ApiError(404, "That scan is not in your Matterport account");
  return linkSpaceByIdDirect(ctx, site.propertyId, space.id, space.name ?? undefined);
}
