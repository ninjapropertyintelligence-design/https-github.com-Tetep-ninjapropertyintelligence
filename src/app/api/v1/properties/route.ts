import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { getLatestHealthSnapshots } from "@/lib/scoring";
import { healthBandFor } from "@/lib/scoring-categories";
import { createPropertySchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { resolvePropertyCoordinates } from "@/lib/geocoding-service";

// GET /api/v1/properties?region=&type=&status=&healthBand=&search=&page=&pageSize=
export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const regionId = url.searchParams.get("region");
  const portfolioId = url.searchParams.get("portfolio");
  const propertyType = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const healthBand = url.searchParams.get("healthBand");
  const search = url.searchParams.get("search");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "25")));

  const where: Prisma.PropertyWhereInput = { AND: [propertyScopeWhere(ctx)] };
  const and = where.AND as Prisma.PropertyWhereInput[];
  if (regionId) and.push({ regionId });
  if (portfolioId) and.push({ portfolioId });
  if (propertyType) and.push({ propertyType });
  if (status) and.push({ status: status as never });
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { addressLine1: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
        { customerPropertyId: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  const [properties, total] = await Promise.all([
    prisma.property.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { region: true, portfolio: true },
    }),
    prisma.property.count({ where }),
  ]);

  const snapshots = await getLatestHealthSnapshots(properties.map((p) => p.id));
  const snapshotByProperty = new Map(snapshots.map((s) => [s.propertyId, s]));

  let items = properties.map((p) => {
    const snap = snapshotByProperty.get(p.id);
    return {
      ...p,
      health: snap
        ? {
            healthScore: snap.healthScore,
            riskScore: snap.riskScore,
            dataConfidenceScore: snap.dataConfidenceScore,
            band: healthBandFor(snap.healthScore),
            computedAt: snap.computedAt,
          }
        : null,
    };
  });

  if (healthBand) {
    items = items.filter((p) => p.health?.band === healthBand);
  }

  return NextResponse.json({ items, total, page, pageSize });
});

// POST /api/v1/properties
export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canManageProperties");
  const body = await req.json();
  const input = createPropertySchema.parse(body);

  // Portfolio/region must belong to the caller's organization — never trust
  // client-supplied IDs blindly, even ones that "look like" valid CUIDs.
  const portfolio = await prisma.portfolio.findFirst({
    where: { id: input.portfolioId, organizationId: ctx.organizationId },
  });
  if (!portfolio) throw new ApiError(400, "Invalid portfolioId for this organization");

  if (input.regionId) {
    const region = await prisma.region.findFirst({
      where: { id: input.regionId, portfolioId: input.portfolioId },
    });
    if (!region) throw new ApiError(400, "Invalid regionId for this portfolio");
  }

  // Geocode the address when the caller didn't supply coordinates, so the
  // property actually shows up on the Portfolio Map (spec §11). Never
  // fatal — see resolvePropertyCoordinates.
  const coordinates = await resolvePropertyCoordinates({
    explicitLatitude: input.latitude,
    explicitLongitude: input.longitude,
    address: {
      addressLine1: input.addressLine1,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      country: input.country,
    },
    organizationId: ctx.organizationId,
  });

  const property = await prisma.property.create({
    data: {
      organizationId: ctx.organizationId,
      portfolioId: input.portfolioId,
      regionId: input.regionId ?? null,
      name: input.name,
      customerPropertyId: input.customerPropertyId ?? null,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2 ?? null,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      country: input.country,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      propertyType: input.propertyType,
      squareFootage: input.squareFootage ?? null,
      yearBuilt: input.yearBuilt ?? null,
      updatedBy: ctx.userId,
    },
  });

  await Promise.all([
    emitEvent({
      organizationId: ctx.organizationId,
      propertyId: property.id,
      type: EVENT_TYPES.PROPERTY_CREATED,
      actorUserId: ctx.userId,
      payload: { name: property.name },
    }),
    writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "property.created",
      entityType: "Property",
      entityId: property.id,
      // Records how the coordinates were obtained, so a geocoder's
      // low-confidence guess is never mistaken for a surveyed position.
      metadata: {
        coordinateSource: coordinates.geocodeConfidence
          ? "geocoded"
          : coordinates.latitude !== null
            ? "explicit"
            : "none",
        geocodeConfidence: coordinates.geocodeConfidence,
      },
    }),
  ]);

  return NextResponse.json(property, { status: 201 });
});
