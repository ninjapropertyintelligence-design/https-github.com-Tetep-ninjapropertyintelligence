/**
 * Geocoding provider abstraction — turns a property's postal address into
 * coordinates so it can appear on the Portfolio Map (spec §11).
 *
 * Without this, a property created through the UI with only an address has
 * `latitude`/`longitude` of null, and the map query
 * (`latitude: { not: null }`) silently excludes it — the property exists
 * but is invisible on the map with no error shown anywhere.
 *
 * Same adapter shape as `InteriorCaptureProvider` and
 * `PhotogrammetryProvider`: callers depend on this interface, never on a
 * specific vendor, so a different geocoder can be swapped in later.
 */

export interface GeocodeAddress {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
}

export type GeocodeConfidence = "exact" | "high" | "medium" | "low";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /**
   * How well the geocoder matched the input. Persisted alongside the
   * coordinates so a low-confidence guess is visibly distinguishable from
   * a surveyed coordinate rather than silently treated as fact.
   */
  confidence: GeocodeConfidence;
  /** The address string the provider actually matched, for audit/debug. */
  matchedAddress: string | null;
}

export interface GeocodingProvider {
  readonly name: string;
  /** True only when credentials are actually present — never attempts a network call otherwise. */
  isConfigured(): boolean;
  /** Returns null when the address can't be resolved. Throws only on transport/API failure. */
  geocode(address: GeocodeAddress): Promise<GeocodeResult | null>;
}

export class GeocodingProviderError extends Error {
  constructor(
    public providerName: string,
    message: string,
  ) {
    super(message);
    this.name = "GeocodingProviderError";
  }
}

export function formatAddressQuery(address: GeocodeAddress): string {
  return [address.addressLine1, address.city, address.state, address.postalCode, address.country]
    .filter((part) => !!part && String(part).trim().length > 0)
    .join(", ");
}
