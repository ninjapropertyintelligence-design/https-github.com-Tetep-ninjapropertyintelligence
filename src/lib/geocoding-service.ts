import { GeocodeAddress, GeocodeResult } from "@/lib/integrations/geocoding-provider";
import { getGeocodingProvider } from "@/lib/integrations/mapbox-geocoding-provider";
import { logEvent } from "@/lib/observability";
import { recordUsage } from "@/lib/cost-metering";
import { UsageMetricType } from "@/generated/prisma/client";

/**
 * Resolves a property's coordinates for the Portfolio Map (spec §11).
 *
 * Two rules, both deliberate:
 *
 * 1. **Explicit coordinates always win.** If a caller supplies lat/lng
 *    (a surveyed value, a drone capture's GPS, a CSV import), we never
 *    overwrite it with a geocoder's guess.
 *
 * 2. **Geocoding failure is never fatal.** Per the spec's vendor-outage
 *    rule (§84: "Property record must still work"), a geocoder that is
 *    unconfigured, down, or rate-limited must not block creating or
 *    editing a property. The property is saved without coordinates and
 *    simply doesn't appear on the map until coordinates arrive — the same
 *    honest-empty-state behaviour used everywhere else in this codebase,
 *    rather than a fabricated location.
 */
export interface ResolvedCoordinates {
  latitude: number | null;
  longitude: number | null;
  /** Null when coordinates were supplied explicitly or couldn't be resolved. */
  geocodeConfidence: GeocodeResult["confidence"] | null;
}

export async function resolvePropertyCoordinates(params: {
  explicitLatitude?: number | null;
  explicitLongitude?: number | null;
  address: GeocodeAddress;
  organizationId?: string;
}): Promise<ResolvedCoordinates> {
  const { explicitLatitude, explicitLongitude } = params;

  // Rule 1 — a caller-supplied pair is authoritative.
  if (typeof explicitLatitude === "number" && typeof explicitLongitude === "number") {
    return { latitude: explicitLatitude, longitude: explicitLongitude, geocodeConfidence: null };
  }

  const provider = getGeocodingProvider();
  if (!provider.isConfigured()) {
    // Honest no-op: no token, no guess, no thrown error.
    return { latitude: null, longitude: null, geocodeConfidence: null };
  }

  try {
    const result = await provider.geocode(params.address);
    /**
     * Metering (§49). A geocoding request is billed by the provider whether
     * or not it resolves to a coordinate, so both outcomes are metered here.
     * The exception path below deliberately is not: when the call throws we
     * cannot tell whether the provider billed it, and inventing either answer
     * would be a guess presented as a measurement.
     *
     * Unattributed: the property does not exist yet at geocode time, so there
     * is no property to attribute this to. That null is the honest answer.
     */
    if (params.organizationId) {
      await recordUsage({
        organizationId: params.organizationId,
        propertyId: null,
        metricType: UsageMetricType.GEOCODING_REQUEST,
        quantity: 1,
        source: "geocoding-service",
        metadata: { provider: provider.name, resolved: result !== null },
      });
    }
    if (!result) {
      logEvent("geocoding.request", {
        ok: true,
        organizationId: params.organizationId,
        provider: provider.name,
        resolved: false,
      });
      return { latitude: null, longitude: null, geocodeConfidence: null };
    }
    return {
      latitude: result.latitude,
      longitude: result.longitude,
      geocodeConfidence: result.confidence,
    };
  } catch (err) {
    // Rule 2 — log it, then let the property save without coordinates.
    logEvent("geocoding.request", {
      ok: false,
      organizationId: params.organizationId,
      provider: provider.name,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { latitude: null, longitude: null, geocodeConfidence: null };
  }
}
