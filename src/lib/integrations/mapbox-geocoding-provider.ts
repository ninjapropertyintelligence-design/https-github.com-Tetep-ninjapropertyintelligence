import {
  GeocodeAddress,
  GeocodeConfidence,
  GeocodeResult,
  GeocodingProvider,
  GeocodingProviderError,
  formatAddressQuery,
} from "@/lib/integrations/geocoding-provider";
import { withObservability } from "@/lib/observability";

/**
 * Mapbox forward geocoding (Geocoding API v6). Mapbox is already this
 * project's map vendor (`PortfolioMap`, `NEXT_PUBLIC_MAPBOX_TOKEN`) and is
 * the vendor the spec names in §11/§83 — reusing it here avoids taking on a
 * second mapping vendor for the same capability.
 *
 * IMPORTANT: like `MatterportProvider`, this is real, non-mocked request
 * code, but no Mapbox token exists in this environment to verify a live
 * round trip against. The endpoint and response shape follow Mapbox's
 * documented Geocoding v6 `forward` contract as of this integration's
 * authoring; the parsing below is deliberately defensive (every field is
 * shape-checked before use, and an unrecognised response yields `null`
 * rather than a bogus coordinate) so an API drift degrades to "couldn't
 * geocode" instead of writing a wrong location onto a property. Confirm
 * against the current reference before relying on it in production.
 */

const MAPBOX_GEOCODE_URL = "https://api.mapbox.com/search/geocode/v6/forward";

/** Coordinates outside these bounds are not valid lat/lng and are rejected. */
function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function normalizeConfidence(raw: unknown): GeocodeConfidence {
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  if (value === "exact" || value === "high" || value === "medium" || value === "low") return value;
  // Unknown/absent match metadata — report the weakest confidence rather
  // than implying a precision the provider never claimed.
  return "low";
}

export class MapboxGeocodingProvider implements GeocodingProvider {
  readonly name = "mapbox";

  constructor(private token: string | undefined) {}

  isConfigured(): boolean {
    return !!this.token;
  }

  async geocode(address: GeocodeAddress): Promise<GeocodeResult | null> {
    if (!this.isConfigured()) {
      throw new GeocodingProviderError(this.name, "Mapbox geocoding is not configured");
    }
    const query = formatAddressQuery(address);
    if (!query) return null;

    return withObservability("geocoding.request", { provider: this.name }, async () => {
      const url = `${MAPBOX_GEOCODE_URL}?q=${encodeURIComponent(query)}&limit=1&access_token=${encodeURIComponent(this.token!)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new GeocodingProviderError(this.name, `Mapbox geocoding returned ${res.status}: ${body.slice(0, 300)}`);
      }

      const json: unknown = await res.json();
      const features =
        json && typeof json === "object" && Array.isArray((json as { features?: unknown }).features)
          ? ((json as { features: unknown[] }).features as Array<Record<string, unknown>>)
          : [];
      const feature = features[0];
      if (!feature) return null;

      const geometry = feature.geometry as { coordinates?: unknown } | undefined;
      const coords = Array.isArray(geometry?.coordinates) ? geometry.coordinates : null;
      if (!coords || coords.length < 2) return null;

      // GeoJSON order is [longitude, latitude] — not [lat, lng].
      const [lng, lat] = coords as [unknown, unknown];
      if (!isValidLatLng(lat, lng)) return null;

      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      const matchCode = (properties.match_code ?? {}) as Record<string, unknown>;

      return {
        latitude: lat as number,
        longitude: lng as number,
        confidence: normalizeConfidence(matchCode.confidence),
        matchedAddress: typeof properties.full_address === "string" ? properties.full_address : null,
      };
    });
  }
}

/** Used when no token is configured — never guesses a coordinate. */
export class NullGeocodingProvider implements GeocodingProvider {
  readonly name = "none";
  isConfigured(): boolean {
    return false;
  }
  async geocode(): Promise<GeocodeResult | null> {
    throw new GeocodingProviderError(this.name, "No geocoding provider is configured");
  }
}

let cached: GeocodingProvider | null = null;

/**
 * Reads `MAPBOX_TOKEN` (server-only, preferred) and falls back to
 * `NEXT_PUBLIC_MAPBOX_TOKEN` — the map already requires the public token,
 * and Mapbox public tokens are permitted to call the Geocoding API, so a
 * deployment that has a working map gets geocoding without extra setup.
 * A separate server token is still preferable so geocoding quota isn't
 * spent by anyone who reads the public token out of the browser bundle.
 */
export function getGeocodingProvider(): GeocodingProvider {
  if (cached) return cached;
  const token = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  cached = token ? new MapboxGeocodingProvider(token) : new NullGeocodingProvider();
  return cached;
}
