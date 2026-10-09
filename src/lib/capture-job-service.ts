import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import {
  CaptureDeliverable,
  CaptureJobSiteStatus,
  CaptureJobStatus,
  CaptureShotKind,
  IssueSource,
  NotificationType,
  Role,
} from "@/generated/prisma/client";
import { propertyScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { recordAssetConditionChange } from "@/lib/asset-condition";
import { createDroneCapture, createDroneDataset } from "@/lib/drone-service";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { notifyPropertyStakeholders, notifyVendorUsers } from "@/lib/notifications";
import { distanceMeters } from "@/lib/media/panorama-metadata";

/**
 * Capture jobs — work ordered from a subcontractor.
 *
 * The job is three things at once, and that is the point:
 *
 * 1. A WORK ORDER. Go to these sites, produce these deliverables, by this
 *    date. Without it, running subcontractors means a spreadsheet beside the
 *    product, which is the thing the product is supposed to replace.
 *
 * 2. AN AUTHORIZATION. A vendor has no property access of its own; issuing a
 *    job grants access to exactly its sites, and accepting or cancelling it
 *    takes that access away. See `propertyScopeWhere`. Standing contractor
 *    accounts that outlive the work are how this normally leaks.
 *
 * 3. A DEFINITION OF DONE. A site cannot be submitted until its deliverables
 *    exist. CONDITION_SCORES is the one that matters: imagery never moves a
 *    property's health score, because the score is computed from asset
 *    condition. A job that asks only for pictures buys pictures.
 */

/** Statuses in which a vendor may still act on a job. */
const OPEN_STATUSES: CaptureJobStatus[] = [
  CaptureJobStatus.ISSUED,
  CaptureJobStatus.SUBMITTED,
  CaptureJobStatus.REJECTED,
];

export interface CreateCaptureJobInput {
  title: string;
  vendorId?: string | null;
  instructions?: string | null;
  dueDate?: Date | null;
  propertyIds: string[];
  deliverables: CaptureDeliverable[];
  /**
   * The route, applied to every site on the job.
   *
   * Defined once and instantiated per site, so the positions are named
   * identically across a 400-store portfolio while completion is tracked per
   * store. Identical naming is the whole point: it is what lets this year's
   * "north lot" be compared with last year's.
   */
  shots?: Array<{ label: string; kind?: CaptureShotKind; required?: boolean; notes?: string }>;
}

/**
 * Creates a DRAFT job. Draft deliberately, not issued: a job being assembled
 * must not appear in a vendor's queue as work they already owe.
 */
export async function createCaptureJob(ctx: SessionContext, input: CreateCaptureJobInput) {
  if (input.propertyIds.length === 0) throw new ApiError(400, "A capture job needs at least one site");
  if (input.deliverables.length === 0) {
    throw new ApiError(400, "A capture job needs at least one deliverable");
  }

  // Every site is re-scoped rather than trusted. These ids arrive from a
  // client, and a job is an access grant — an unscoped id here would hand a
  // subcontractor a property the person creating the job cannot even see.
  const properties = await prisma.property.findMany({
    where: { AND: [{ id: { in: input.propertyIds } }, propertyScopeWhere(ctx)] },
    select: { id: true },
  });
  if (properties.length !== new Set(input.propertyIds).size) {
    throw new ApiError(400, "One or more sites do not exist, or you don't have access to them");
  }

  if (input.vendorId) {
    const vendor = await prisma.vendor.findFirst({
      where: { id: input.vendorId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!vendor) throw new ApiError(400, "Unknown vendor");
  }

  // Positions named the same as on an earlier job at the same site start with
  // that job's pin. The route is the same six places every visit — that is
  // its purpose — so a pin placed once should not have to be placed again on
  // every job, and GPS matching works from the second visit with no setup.
  const previousPins = input.shots?.length ? await latestPinsByLabel(properties.map((p) => p.id)) : new Map();

  return prisma.captureJob.create({
    data: {
      organizationId: ctx.organizationId,
      vendorId: input.vendorId ?? null,
      title: input.title,
      instructions: input.instructions ?? null,
      dueDate: input.dueDate ?? null,
      createdById: ctx.userId,
      sites: {
        create: properties.map((p) => ({
          propertyId: p.id,
          deliverables: input.deliverables,
          shots: input.shots?.length
            ? {
                // Sequence is the walking order, assigned from the order the
                // positions were given rather than sorted later — a route is
                // not alphabetical.
                create: input.shots.map((shot, index) => {
                  const pin = previousPins.get(pinKey(p.id, shot.label));
                  return {
                    label: shot.label,
                    kind: shot.kind ?? CaptureShotKind.IMAGE_360,
                    required: shot.required ?? true,
                    notes: shot.notes ?? null,
                    sequence: index + 1,
                    latitude: pin?.latitude ?? null,
                    longitude: pin?.longitude ?? null,
                  };
                }),
              }
            : undefined,
        })),
      },
    },
    include: { sites: true },
  });
}

function pinKey(propertyId: string, label: string): string {
  return `${propertyId}\u0000${label.trim().toLowerCase()}`;
}

/** The most recent pin for each (site, position name) across earlier jobs. */
async function latestPinsByLabel(propertyIds: string[]) {
  const rows = await prisma.captureShot.findMany({
    where: { site: { propertyId: { in: propertyIds } }, latitude: { not: null }, longitude: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { label: true, latitude: true, longitude: true, site: { select: { propertyId: true } } },
    take: 5000,
  });
  const pins = new Map<string, { latitude: number; longitude: number }>();
  for (const row of rows) {
    const key = pinKey(row.site.propertyId, row.label);
    if (!pins.has(key)) pins.set(key, { latitude: row.latitude!, longitude: row.longitude! });
  }
  return pins;
}

/**
 * One job, scoped.
 *
 * A vendor sees their own jobs and only while those are open; everyone else
 * sees their organization's. Written as one where clause rather than a fetch
 * followed by a check, so there is no window in which the row is in memory
 * before the caller's right to it has been established.
 */
export async function getCaptureJob(ctx: SessionContext, jobId: string) {
  const job = await prisma.captureJob.findFirst({
    where: {
      id: jobId,
      organizationId: ctx.organizationId,
      ...(ctx.role === Role.VENDOR
        ? { vendorId: ctx.vendorId ?? "__no_vendor__", status: { in: OPEN_STATUSES } }
        : {}),
    },
    include: {
      vendor: { select: { id: true, name: true } },
      sites: {
        include: {
          property: {
            select: { id: true, name: true, addressLine1: true, city: true, state: true, latitude: true, longitude: true },
          },
          shots: {
            orderBy: { sequence: "asc" },
            include: { _count: { select: { evidence: true } } },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!job) throw new ApiError(404, "Capture job not found");
  return job;
}

export async function listCaptureJobs(ctx: SessionContext) {
  return prisma.captureJob.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(ctx.role === Role.VENDOR
        ? { vendorId: ctx.vendorId ?? "__no_vendor__", status: { in: OPEN_STATUSES } }
        : {}),
    },
    include: {
      vendor: { select: { id: true, name: true } },
      sites: { select: { id: true, status: true } },
    },
    // By due date, soonest first. A job with no date sorts last rather than
    // first, which is what NULL would otherwise do — and "no deadline" is not
    // the most urgent thing on the list.
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
  });
}

/** Moves a DRAFT job to ISSUED, which is also what grants the vendor access. */
export async function issueCaptureJob(ctx: SessionContext, jobId: string) {
  const job = await getCaptureJob(ctx, jobId);
  if (ctx.role === Role.VENDOR) throw new ApiError(403, "Only the ordering organization can issue a job");
  if (job.status !== CaptureJobStatus.DRAFT) {
    throw new ApiError(409, `This job is ${job.status.toLowerCase()} and cannot be issued again`);
  }
  // Issuing without a vendor would grant access to nobody and make the job
  // look dispatched. Refused rather than silently issued into the void.
  if (!job.vendorId) throw new ApiError(400, "Assign a vendor before issuing the job");

  const updated = await prisma.captureJob.update({
    where: { id: jobId },
    data: { status: CaptureJobStatus.ISSUED, issuedAt: new Date() },
  });
  await emitEvent({
    organizationId: ctx.organizationId,
    type: EVENT_TYPES.CAPTURE_CREATED,
    actorUserId: ctx.userId,
    payload: { captureJobId: jobId, vendorId: job.vendorId, siteCount: job.sites.length },
  });
  return updated;
}

/**
 * What a site still owes.
 *
 * Counted from the data, not from a checkbox the vendor ticks. A deliverable
 * is satisfied when the artefact exists on that property, which is the only
 * version of "done" that cannot be claimed without doing the work.
 */
export async function outstandingDeliverables(
  siteId: string,
): Promise<{ propertyId: string; missing: CaptureDeliverable[] }> {
  const site = await prisma.captureJobSite.findUniqueOrThrow({
    where: { id: siteId },
    select: { propertyId: true, deliverables: true, job: { select: { issuedAt: true } } },
  });

  // Only work delivered since the job was issued counts. Without this, a job
  // is satisfied on day one by whatever imagery the site already had, which
  // would let a subcontractor be paid for a previous vendor's capture.
  const since = site.job.issuedAt ?? new Date(0);
  const propertyId = site.propertyId;

  const [droneCount, matterportCount, panoramaCount, photoCount, conditionCount] = await Promise.all([
    prisma.droneCapture.count({ where: { propertyId, createdAt: { gte: since } } }),
    prisma.matterportPropertyLink.count({ where: { propertyId, linkedAt: { gte: since } } }),
    prisma.evidence.count({ where: { propertyId, type: "IMAGE_360", createdAt: { gte: since } } }),
    prisma.evidence.count({ where: { propertyId, type: "PHOTO", createdAt: { gte: since } } }),
    prisma.assetConditionHistory.count({
      where: { asset: { propertyId }, changedAt: { gte: since } },
    }),
  ]);

  const satisfied: Record<CaptureDeliverable, boolean> = {
    DRONE: droneCount > 0,
    MATTERPORT: matterportCount > 0,
    IMAGE_360: panoramaCount > 0,
    PHOTOS: photoCount > 0,
    CONDITION_SCORES: conditionCount > 0,
  };

  return { propertyId, missing: site.deliverables.filter((d) => !satisfied[d]) };
}

/**
 * Required positions on this site that nothing has been captured against.
 *
 * Counted from linked evidence, never from a flag on the shot — the same rule
 * as the deliverables, because a route someone can tick off without walking
 * it is worth nothing.
 */
export async function outstandingShots(siteId: string): Promise<Array<{ id: string; label: string }>> {
  const shots = await prisma.captureShot.findMany({
    where: { siteId, required: true },
    orderBy: { sequence: "asc" },
    select: { id: true, label: true, _count: { select: { evidence: true } } },
  });
  return shots.filter((s) => s._count.evidence === 0).map((s) => ({ id: s.id, label: s.label }));
}

/** A pin further than this from the site is a typo or the wrong site, not a position on it. */
export const MAX_SHOT_DISTANCE_FROM_SITE_METERS = 2000;

/**
 * Places (or clears) the pins for a site's shot positions.
 *
 * Staff only: where the positions are is part of what the ordering
 * organization specifies, not something the vendor being measured against it
 * gets to move. Pins are checked against the site's own location so a
 * swapped latitude/longitude, or a pin dropped on the wrong store, is refused
 * rather than silently matching every photo to nothing.
 */
export async function setShotLocations(
  ctx: SessionContext,
  jobId: string,
  siteId: string,
  locations: Array<{ shotId: string; latitude: number | null; longitude: number | null }>,
) {
  if (ctx.role === Role.VENDOR) throw new ApiError(403, "Only the ordering organization can place shot positions");
  const { job, site } = await siteForAction(ctx, jobId, siteId);
  if (job.status === CaptureJobStatus.ACCEPTED || job.status === CaptureJobStatus.CANCELLED) {
    throw new ApiError(409, `This job is ${job.status.toLowerCase()} and can no longer be changed`);
  }

  const shotIds = new Set(site.shots.map((s) => s.id));
  for (const loc of locations) {
    if (!shotIds.has(loc.shotId)) throw new ApiError(400, "One or more positions are not on this site's route");
    if ((loc.latitude === null) !== (loc.longitude === null)) {
      throw new ApiError(400, "A position needs both a latitude and a longitude, or neither");
    }
    if (loc.latitude === null || loc.longitude === null) continue;
    if (Math.abs(loc.latitude) > 90 || Math.abs(loc.longitude) > 180) {
      throw new ApiError(400, "Latitude must be between -90 and 90 and longitude between -180 and 180");
    }
    const { latitude: siteLat, longitude: siteLng } = site.property;
    if (siteLat !== null && siteLng !== null) {
      const d = distanceMeters(siteLat, siteLng, loc.latitude, loc.longitude);
      if (d > MAX_SHOT_DISTANCE_FROM_SITE_METERS) {
        const label = site.shots.find((s) => s.id === loc.shotId)?.label ?? "A position";
        throw new ApiError(
          400,
          `${label} is ${(d / 1000).toFixed(1)} km from ${site.property.name} — check the coordinates (latitude first, then longitude)`,
        );
      }
    }
  }

  await prisma.$transaction(
    locations.map((loc) =>
      prisma.captureShot.update({
        where: { id: loc.shotId },
        data: { latitude: loc.latitude, longitude: loc.longitude },
      }),
    ),
  );
  return prisma.captureShot.findMany({ where: { siteId }, orderBy: { sequence: "asc" } });
}

/**
 * The route a 360 import on this property should match against: the shots of
 * the most recent open capture-job site here, if there is one.
 *
 * Scoped through `getCaptureJob`'s rules — a vendor only ever sees a route on
 * one of their own open jobs.
 */
export async function openRouteForProperty(ctx: SessionContext, propertyId: string) {
  const site = await prisma.captureJobSite.findFirst({
    where: {
      propertyId,
      status: { not: CaptureJobSiteStatus.ACCEPTED },
      shots: { some: { kind: CaptureShotKind.IMAGE_360 } },
      job: {
        organizationId: ctx.organizationId,
        status: { in: OPEN_STATUSES },
        ...(ctx.role === Role.VENDOR ? { vendorId: ctx.vendorId ?? "__no_vendor__" } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      job: { select: { id: true, title: true } },
      shots: {
        where: { kind: CaptureShotKind.IMAGE_360 },
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          label: true,
          sequence: true,
          latitude: true,
          longitude: true,
          _count: { select: { evidence: true } },
        },
      },
    },
  });
  if (!site) return null;
  return {
    jobId: site.job.id,
    jobTitle: site.job.title,
    siteId: site.id,
    shots: site.shots.map((s) => ({
      id: s.id,
      label: s.label,
      sequence: s.sequence,
      latitude: s.latitude,
      longitude: s.longitude,
      captured: s._count.evidence > 0,
    })),
  };
}

/** Loads a site the caller may act on, with the job's state already checked. */
async function siteForAction(ctx: SessionContext, jobId: string, siteId: string) {
  const job = await getCaptureJob(ctx, jobId);
  const site = job.sites.find((s) => s.id === siteId);
  if (!site) throw new ApiError(404, "Site not found on this capture job");
  return { job, site };
}

/**
 * The subcontractor's condition scores — the deliverable that actually moves
 * the number.
 *
 * Every score goes through `recordAssetConditionChange`, the one path that
 * appends history, recomputes the asset, and recalculates the property's
 * health snapshot. Writing `Asset.conditionScore` directly here would produce
 * a score with no provenance and a stale property snapshot.
 *
 * Scores apply immediately rather than on acceptance. The history row records
 * who submitted it and against which job, so a rejected submission is
 * traceable and correctable — but a reviewer rejecting a site does NOT unwind
 * the scores. That is a deliberate limit of this version, not an oversight:
 * unwinding would mean a staging model, and an append-only history with clear
 * provenance is the weaker but honest version of the same guarantee.
 */
export async function submitConditionScores(
  ctx: SessionContext,
  jobId: string,
  siteId: string,
  scores: Array<{ assetId: string; score: number; reason?: string | null; evidenceId?: string | null }>,
) {
  if (scores.length === 0) throw new ApiError(400, "No condition scores submitted");

  const { job, site } = await siteForAction(ctx, jobId, siteId);
  if (!OPEN_STATUSES.includes(job.status)) {
    throw new ApiError(409, `This job is ${job.status.toLowerCase()} and no longer accepts submissions`);
  }
  if (site.status === CaptureJobSiteStatus.ACCEPTED) {
    throw new ApiError(409, "This site has been accepted and no longer accepts submissions");
  }

  // Assets are re-scoped to the site's property. An asset id from another of
  // the vendor's sites would otherwise be accepted here, silently scoring the
  // wrong building.
  const assetIds = [...new Set(scores.map((s) => s.assetId))];
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds }, propertyId: site.propertyId },
    select: { id: true },
  });
  if (assets.length !== assetIds.length) {
    throw new ApiError(400, "One or more assets do not belong to this site");
  }

  for (const entry of scores) {
    await recordAssetConditionChange({
      assetId: entry.assetId,
      newScore: entry.score,
      changedByUserId: ctx.userId,
      source: IssueSource.MANUAL,
      // The provenance a reviewer needs: which job, so a disputed score leads
      // back to the visit that produced it.
      reason: entry.reason?.trim() || `Capture job: ${job.title}`,
      evidenceId: entry.evidenceId ?? undefined,
    });
  }

  if (site.status === CaptureJobSiteStatus.PENDING) {
    await prisma.captureJobSite.update({
      where: { id: siteId },
      data: { status: CaptureJobSiteStatus.IN_PROGRESS },
    });
  }

  return { scored: scores.length, propertyId: site.propertyId };
}

/** The vendor marking one site delivered. Refused while anything is missing. */
export async function submitCaptureSite(ctx: SessionContext, jobId: string, siteId: string) {
  const { job, site } = await siteForAction(ctx, jobId, siteId);
  if (!OPEN_STATUSES.includes(job.status)) {
    throw new ApiError(409, `This job is ${job.status.toLowerCase()} and no longer accepts submissions`);
  }
  if (site.status === CaptureJobSiteStatus.ACCEPTED) {
    throw new ApiError(409, "This site has already been accepted");
  }

  const { missing } = await outstandingDeliverables(siteId);
  if (missing.length > 0) {
    // Named, not just refused. "Incomplete" sends a subcontractor back to
    // guess which of five deliverables is short.
    throw new ApiError(
      400,
      `This site still owes: ${missing.map((d) => d.replace(/_/g, " ").toLowerCase()).join(", ")}`,
    );
  }

  // And the route. A site can hold every deliverable and still be missing
  // half its positions — which is exactly the failure the shot list exists to
  // prevent, because it is invisible until someone tries to compare this
  // visit with the last one.
  const unshot = await outstandingShots(siteId);
  if (unshot.length > 0) {
    throw new ApiError(
      400,
      `These positions have not been captured: ${unshot.map((s) => s.label).join(", ")}`,
    );
  }

  const submitted = await prisma.captureJobSite.update({
    where: { id: siteId },
    data: { status: CaptureJobSiteStatus.SUBMITTED, submittedAt: new Date(), rejectionReason: null },
  });

  // Nothing else tells the reviewers. Without this the work sits SUBMITTED
  // until someone happens to open the job page, which on a 40-site sweep is
  // how a subcontractor waits a week to be paid for work already delivered.
  //
  // Best-effort: a notification failure must not undo a submission that has
  // already been accepted and recorded. The site is submitted either way.
  try {
    await notifyPropertyStakeholders({
      propertyId: site.propertyId,
      type: NotificationType.CAPTURE_SUBMITTED,
      title: `Capture ready for review: ${site.property.name}`,
      body: `${job.vendor?.name ?? "A vendor"} submitted this site for "${job.title}".`,
      link: `/capture-jobs/${job.id}`,
    });
  } catch {
    // Swallowed deliberately — see above.
  }

  return submitted;
}

/** Acceptance or rejection by the ordering organization. */
export async function reviewCaptureSite(
  ctx: SessionContext,
  jobId: string,
  siteId: string,
  decision: { accept: boolean; reason?: string | null },
) {
  if (ctx.role === Role.VENDOR) throw new ApiError(403, "A vendor cannot review its own submission");
  const { job, site } = await siteForAction(ctx, jobId, siteId);
  if (site.status !== CaptureJobSiteStatus.SUBMITTED) {
    throw new ApiError(409, "Only a submitted site can be reviewed");
  }
  if (!decision.accept && !decision.reason?.trim()) {
    // A rejection with no reason is a site the vendor will resubmit unchanged.
    throw new ApiError(400, "A rejection needs a reason the vendor can act on");
  }

  const updated = await prisma.captureJobSite.update({
    where: { id: siteId },
    data: {
      status: decision.accept ? CaptureJobSiteStatus.ACCEPTED : CaptureJobSiteStatus.REJECTED,
      reviewedAt: new Date(),
      reviewedById: ctx.userId,
      rejectionReason: decision.accept ? null : (decision.reason ?? null),
    },
  });

  // The job closes itself once every site is accepted — which is also what
  // ends the vendor's access. Leaving that to someone remembering to press a
  // button is how contractor access outlives the contract.
  const remaining = await prisma.captureJobSite.count({
    where: { jobId, status: { not: CaptureJobSiteStatus.ACCEPTED } },
  });
  const jobClosed = remaining === 0;
  if (jobClosed) {
    await prisma.captureJob.update({
      where: { id: jobId },
      data: { status: CaptureJobStatus.ACCEPTED, closedAt: new Date() },
    });
  }

  // The vendor is the one who has to act on a rejection, and until now they
  // had no way of learning about it short of re-opening a job they believed
  // was finished.
  //
  // The reason is carried in the body, not just the fact of rejection: the
  // reason IS the instruction, and this notification is the only place most
  // vendors will read it.
  if (job.vendorId) {
    try {
      await notifyVendorUsers({
        organizationId: ctx.organizationId,
        vendorId: job.vendorId,
        type: decision.accept ? NotificationType.CAPTURE_ACCEPTED : NotificationType.CAPTURE_REJECTED,
        title: decision.accept
          ? `Capture accepted: ${site.property.name}`
          : `Capture returned: ${site.property.name}`,
        body: decision.accept
          ? jobClosed
            ? `All sites on "${job.title}" are accepted. This job is now closed and its site access has ended.`
            : `Accepted for "${job.title}".`
          : (decision.reason?.trim() ?? undefined),
        // A closed job is refused by `getCaptureJob` for a vendor, so linking
        // there would land them on a 404 at the exact moment they are being
        // told the work is done. Their job list is somewhere that still exists.
        link: jobClosed && decision.accept ? "/capture-jobs" : `/capture-jobs/${jobId}`,
      });
    } catch {
      // Best-effort, as with submission: the review decision is recorded.
    }
  }

  return updated;
}


/**
 * Where drone files for this site should go.
 *
 * A subcontractor should not have to understand that drone imagery hangs off
 * a capture, which hangs off a dataset. They picked "drone imagery" and
 * dropped 400 files; this resolves that into a dataset id.
 *
 * An in-flight capture is REUSED rather than a new one created per upload.
 * Without that, a vendor who uploads in three sittings produces three
 * captures of the same flight, and the Exterior tab's date selector fills
 * with duplicates that each hold a third of the photos.
 */
export async function resolveDroneTargetForSite(
  ctx: SessionContext,
  jobId: string,
  siteId: string,
): Promise<{ captureId: string; datasetId: string }> {
  const { job, site } = await siteForAction(ctx, jobId, siteId);
  if (!OPEN_STATUSES.includes(job.status)) {
    throw new ApiError(409, `This job is ${job.status.toLowerCase()} and no longer accepts uploads`);
  }

  const existing = await prisma.droneCapture.findFirst({
    where: { propertyId: site.propertyId, status: { in: ["CREATED", "UPLOADING", "PROCESSING"] } },
    orderBy: { createdAt: "desc" },
    include: { datasets: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (existing?.datasets[0]) {
    return { captureId: existing.id, datasetId: existing.datasets[0].id };
  }

  const capture = existing ?? (await createDroneCapture(ctx, site.propertyId, { capturedAt: new Date() }));
  const dataset = await createDroneDataset(ctx, capture.id);
  return { captureId: capture.id, datasetId: dataset.id };
}
