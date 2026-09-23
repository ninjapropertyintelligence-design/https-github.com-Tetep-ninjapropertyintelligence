import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { SessionContext, propertyScopeWhere } from "@/lib/tenant-scope";

/**
 * The per-site "what has been captured here" model behind the Site Map tab.
 *
 * Every layer is counted. Only some can be *placed*: `DroneImage` and
 * `Evidence` carry latitude/longitude, and nothing else in the schema does.
 * A layer without coordinates is reported with `mapped: false` and an empty
 * marker list rather than being pinned at the property centroid — dropping a
 * document or an asset on the building's coordinate would invent a position
 * the data never recorded, and a viewer has no way to tell an invented pin
 * from a surveyed one. The UI shows those layers as counts that link to the
 * tab that owns them.
 */

export interface SiteMarker {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
}

export interface SiteLayer {
  key: string;
  label: string;
  /** Hex, used for both the legend swatch and the marker fill. */
  color: string;
  count: number;
  /** True when this layer's records carry coordinates and can be drawn. */
  mapped: boolean;
  markers: SiteMarker[];
  /** Tab on the property page that owns this layer, for the count to link to. */
  href: string | null;
}

export interface SiteCapture {
  id: string;
  /** Nullable in the schema: a capture can be registered before its flight date is known. */
  capturedAt: Date | null;
  droneModel: string | null;
  status: string;
}

export interface SiteMapData {
  property: {
    id: string;
    name: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    customerPropertyId: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  /** Every capture for this property, newest first — the selector's options. */
  captures: SiteCapture[];
  /** Which one the layer counts below describe. Null when none exist. */
  selectedCaptureId: string | null;
  lastCaptureAt: Date | null;
  totalMedia: number;
  layers: SiteLayer[];
}

export async function getSiteMapData(
  ctx: SessionContext,
  propertyId: string,
  /**
   * Which capture to describe. Defaults to the newest. An id that does not
   * belong to THIS property falls back to the newest rather than being
   * honoured — the capture list is a URL parameter, so treating it as a
   * lookup key without re-scoping it would let one property's URL read
   * another's imagery.
   */
  requestedCaptureId?: string | null,
): Promise<SiteMapData> {
  const property = await prisma.property.findFirst({
    where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] },
    select: {
      id: true,
      name: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
      customerPropertyId: true,
      latitude: true,
      longitude: true,
    },
  });
  if (!property) throw new ApiError(404, "Property not found");

  const tab = (key: string) => `/properties/${propertyId}?tab=${key}`;

  // Captures are loaded first because everything capture-scoped below filters
  // on the selected one. Scoped to this property, which is what makes the
  // requested id safe to use.
  const captures = await prisma.droneCapture.findMany({
    where: { propertyId },
    // nulls last: a capture with no recorded date must not be picked as the
    // most recent one just because NULL sorts first.
    orderBy: { capturedAt: { sort: "desc", nulls: "last" } },
    select: { id: true, capturedAt: true, droneModel: true, status: true },
  });
  const selected = captures.find((c) => c.id === requestedCaptureId) ?? captures[0] ?? null;

  // Drone imagery hangs off capture -> dataset -> image, so the filter
  // travels through the relation rather than an id list. With no capture at
  // all, an impossible id keeps the query shape identical instead of
  // branching every call site.
  const captureFilter = { dataset: { captureId: selected?.id ?? "__none__" } };

  const [droneImages, evidence, outputs, vrTours, assets, openIssues, documents, assessments] =
    await Promise.all([
      prisma.droneImage.findMany({
        where: captureFilter,
        select: { id: true, latitude: true, longitude: true, storageKey: true, capturedAt: true },
      }),
      // Property-level, deliberately NOT capture-scoped: evidence is attached
      // to issues and assessments, not to a drone flight. The panel says so.
      prisma.evidence.findMany({
        where: { propertyId },
        select: { id: true, latitude: true, longitude: true, type: true, captureDate: true },
      }),
      prisma.droneOutput.groupBy({
        by: ["outputType"],
        where: captureFilter,
        _count: { _all: true },
      }),
      prisma.matterportPropertyLink.count({ where: { propertyId } }),
      prisma.asset.count({ where: { propertyId } }),
      prisma.issue.count({ where: { propertyId, status: { notIn: ["RESOLVED", "CLOSED"] } } }),
      prisma.document.count({ where: { propertyId } }),
      prisma.assessment.count({ where: { propertyId } }),
    ]);

  const outputCount = (type: string) => outputs.find((o) => o.outputType === type)?._count._all ?? 0;

  /** Keeps a record out of the marker list unless it has BOTH coordinates. */
  function placed<T extends { id: string; latitude: number | null; longitude: number | null }>(
    rows: T[],
    label: (row: T) => string,
  ): SiteMarker[] {
    return rows
      .filter((r): r is T & { latitude: number; longitude: number } => r.latitude !== null && r.longitude !== null)
      .map((r) => ({ id: r.id, latitude: r.latitude, longitude: r.longitude, label: label(r) }));
  }

  const droneMarkers = placed(droneImages, (r) => r.storageKey.split("-").slice(5).join("-") || "Drone photo");

  // 360 panoramas are split out of the evidence layer rather than counted
  // with it. They are a sellable capture kind in their own right — the third
  // one, alongside Matterport and drone — and a site that has been shot in
  // 360 should say so instead of folding those shots into a generic photo
  // count. They are the only capture kind with BOTH coordinates and a viewer,
  // so their pins open the thing they point at.
  const panoramas = evidence.filter((e) => e.type === "IMAGE_360");
  const otherEvidence = evidence.filter((e) => e.type !== "IMAGE_360");
  const panoramaMarkers = placed(panoramas, () => "360° panorama");
  const evidenceMarkers = placed(otherEvidence, (r) => r.type.replace(/_/g, " "));

  const layers: SiteLayer[] = [
    {
      key: "drone-photos",
      label: "Drone Photos",
      color: "#2453ff",
      count: droneImages.length,
      // A layer is only "mapped" when something in it actually landed a pin.
      // Reporting mapped:true for a set of photos that all lack EXIF geotags
      // would offer a toggle that visibly does nothing.
      mapped: droneMarkers.length > 0,
      markers: droneMarkers,
      href: tab("exterior"),
    },
    {
      key: "evidence-photos",
      label: "Evidence Photos",
      color: "#e2691a",
      count: otherEvidence.length,
      mapped: evidenceMarkers.length > 0,
      markers: evidenceMarkers,
      href: tab("issues"),
    },
    {
      key: "360-images",
      label: "360° Panoramas",
      color: "#c026d3",
      count: panoramas.length,
      mapped: panoramaMarkers.length > 0,
      markers: panoramaMarkers,
      href: tab("360"),
    },
    {
      key: "vr-tours",
      label: "3DVR Tours",
      color: "#12a594",
      count: vrTours,
      mapped: false,
      markers: [],
      href: tab("interior"),
    },
    {
      key: "3d-models",
      label: "3D Models",
      color: "#1a9c5c",
      count: outputCount("MESH_3D"),
      mapped: false,
      markers: [],
      href: tab("digital-twin"),
    },
    {
      key: "point-clouds",
      label: "Point Clouds",
      color: "#7c5cff",
      count: outputCount("POINT_CLOUD"),
      mapped: false,
      markers: [],
      href: tab("digital-twin"),
    },
    {
      key: "orthomosaics",
      label: "Orthomosaics",
      color: "#0e7fa8",
      count: outputCount("ORTHOMOSAIC"),
      mapped: false,
      markers: [],
      href: tab("exterior"),
    },
    {
      key: "elevation",
      label: "Elevation (DSM/DTM)",
      color: "#8a6d3b",
      count: outputCount("DSM") + outputCount("DTM"),
      mapped: false,
      markers: [],
      href: tab("exterior"),
    },
    {
      key: "assets",
      label: "Assets",
      color: "#5b6472",
      count: assets,
      mapped: false,
      markers: [],
      href: tab("assets"),
    },
    {
      key: "issues",
      label: "Open Issues",
      color: "#d0342c",
      count: openIssues,
      mapped: false,
      markers: [],
      href: tab("issues"),
    },
    {
      key: "assessments",
      label: "Assessments",
      color: "#d99a12",
      count: assessments,
      mapped: false,
      markers: [],
      href: tab("assessments"),
    },
    {
      key: "documents",
      label: "Documents",
      color: "#4c9c1a",
      count: documents,
      mapped: false,
      markers: [],
      href: tab("documents"),
    },
  ];

  // "Media" counts captured artefacts. Assets, issues, assessments and
  // documents are records about the site, not captures of it, so including
  // them would inflate the headline into something that does not mean
  // anything.
  const MEDIA_KEYS = new Set([
    "drone-photos",
    "evidence-photos",
    "360-images",
    "vr-tours",
    "3d-models",
    "point-clouds",
    "orthomosaics",
    "elevation",
  ]);

  return {
    property,
    captures,
    selectedCaptureId: selected?.id ?? null,
    // The SELECTED capture's date, not the newest — the panel's header has to
    // agree with the counts underneath it.
    lastCaptureAt: selected?.capturedAt ?? null,
    totalMedia: layers.filter((l) => MEDIA_KEYS.has(l.key)).reduce((sum, l) => sum + l.count, 0),
    layers,
  };
}
