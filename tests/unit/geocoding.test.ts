import { afterEach, describe, expect, it, vi } from "vitest";
import { MapboxGeocodingProvider, NullGeocodingProvider } from "@/lib/integrations/mapbox-geocoding-provider";
import { formatAddressQuery } from "@/lib/integrations/geocoding-provider";

const ADDRESS = {
  addressLine1: "4821 W Chestnut Expy",
  city: "Kansas City",
  state: "MO",
  postalCode: "64105",
  country: "US",
};

/** Builds a Mapbox Geocoding v6 `forward` response body. */
function mapboxResponse(feature: unknown) {
  return { features: feature === null ? [] : [feature] };
}

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("address query formatting", () => {
  it("joins the address parts and skips empty ones", () => {
    expect(formatAddressQuery(ADDRESS)).toBe("4821 W Chestnut Expy, Kansas City, MO, 64105, US");
    expect(formatAddressQuery({ ...ADDRESS, country: null, postalCode: "" })).toBe("4821 W Chestnut Expy, Kansas City, MO");
  });
});

describe("MapboxGeocodingProvider", () => {
  it("is not configured without a token, and never calls the network", async () => {
    const provider = new MapboxGeocodingProvider(undefined);
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.geocode(ADDRESS)).rejects.toThrow(/not configured/i);
  });

  it("parses a well-formed response, reading GeoJSON [lng, lat] in the right order", async () => {
    mockFetchOnce(
      mapboxResponse({
        geometry: { coordinates: [-94.5786, 39.0997] },
        properties: { full_address: "4821 W Chestnut Expy, Kansas City, MO 64105", match_code: { confidence: "exact" } },
      }),
    );
    const result = await new MapboxGeocodingProvider("tok").geocode(ADDRESS);
    // Latitude is the SECOND element in GeoJSON — a swapped pair would put
    // this property in the Indian Ocean instead of Missouri.
    expect(result).toEqual({
      latitude: 39.0997,
      longitude: -94.5786,
      confidence: "exact",
      matchedAddress: "4821 W Chestnut Expy, Kansas City, MO 64105",
    });
  });

  it("returns null when the address matches nothing", async () => {
    mockFetchOnce(mapboxResponse(null));
    expect(await new MapboxGeocodingProvider("tok").geocode(ADDRESS)).toBeNull();
  });

  it("reports low confidence when the provider omits match metadata, rather than implying precision", async () => {
    mockFetchOnce(mapboxResponse({ geometry: { coordinates: [-94.5786, 39.0997] }, properties: {} }));
    const result = await new MapboxGeocodingProvider("tok").geocode(ADDRESS);
    expect(result?.confidence).toBe("low");
    expect(result?.matchedAddress).toBeNull();
  });

  it("returns null instead of a bogus coordinate when the response shape drifts", async () => {
    const provider = new MapboxGeocodingProvider("tok");

    mockFetchOnce({ notWhatWeExpected: true });
    expect(await provider.geocode(ADDRESS)).toBeNull();

    mockFetchOnce(mapboxResponse({ geometry: { coordinates: [-94.5786] }, properties: {} }));
    expect(await provider.geocode(ADDRESS)).toBeNull();

    mockFetchOnce(mapboxResponse({ geometry: { coordinates: ["-94.5786", "39.0997"] }, properties: {} }));
    expect(await provider.geocode(ADDRESS)).toBeNull();
  });

  it("rejects out-of-range coordinates rather than writing them onto a property", async () => {
    mockFetchOnce(mapboxResponse({ geometry: { coordinates: [-400, 120] }, properties: {} }));
    expect(await new MapboxGeocodingProvider("tok").geocode(ADDRESS)).toBeNull();
  });

  it("throws on a transport/API failure so the caller can log it", async () => {
    mockFetchOnce({ message: "Unauthorized" }, false, 401);
    await expect(new MapboxGeocodingProvider("tok").geocode(ADDRESS)).rejects.toThrow(/401/);
  });
});

describe("NullGeocodingProvider", () => {
  it("never guesses a coordinate", async () => {
    const provider = new NullGeocodingProvider();
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.geocode()).rejects.toThrow(/no geocoding provider/i);
  });
});
