import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { ApiError } from "@/lib/api-error";
import { createPropertySchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { resolvePropertyCoordinates } from "@/lib/geocoding-service";
import type { SessionContext } from "@/lib/tenant-scope";

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

/**
 * Creates one property in the caller's organization.
 *
 * Shared by the customer's own property API and the platform team adding a
 * site while ordering capture work, so both validate the portfolio and
 * region, geocode, and record the same audit trail. Callers check who may
 * create; this checks what is being created.
 */
export async function createProperty(ctx: SessionContext, input: CreatePropertyInput) {
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

  return property;
}
