import { describe, expect, it } from "vitest";
import {
  cornersFromBBox,
  distanceMeters,
  formatArea,
  formatLength,
  lngLatToUtm,
  polygonAreaSquareMeters,
  toLngLat,
  utmToLngLat,
} from "@/lib/geo/georeference";

describe("placing a drone map", () => {
  it("reads UTM back to the right place, to within centimetres", () => {
    // Store #1052, Kansas City — UTM zone 15 north.
    for (const [lng, lat] of [
      [-94.5786, 39.0997],
      [-93.0001, 45.5],
      [-96.9, 30.2],
    ]) {
      const { easting, northing } = lngLatToUtm(lng, lat, 15);
      const [backLng, backLat] = utmToLngLat(easting, northing, 15, false);
      expect(distanceMeters([lng, lat], [backLng, backLat])).toBeLessThan(0.05);
    }
    // On the zone's central meridian at the equator: easting 500 km, northing 0.
    const [lng, lat] = utmToLngLat(500000, 0, 15, false);
    expect(lng).toBeCloseTo(-93, 9);
    expect(lat).toBeCloseTo(0, 9);
  });

  it("handles the southern hemisphere and Web Mercator", () => {
    const sydney = lngLatToUtm(151.2093, -33.8688, 56);
    const [lng, lat] = toLngLat(sydney.easting, sydney.northing, 32756)!;
    expect(distanceMeters([151.2093, -33.8688], [lng, lat])).toBeLessThan(0.05);

    // 20037508.34 m is 180° in Web Mercator.
    expect(toLngLat(20037508.34, 0, 3857)![0]).toBeCloseTo(180, 5);
    expect(toLngLat(0, 0, 3857)).toEqual([0, 0]);
  });

  it("gives the four corners clockwise from the top left, and refuses what it cannot place", () => {
    const c = cornersFromBBox([-94.58, 39.09, -94.57, 39.1], 4326)!;
    expect(c).toEqual([
      [-94.58, 39.1],
      [-94.57, 39.1],
      [-94.57, 39.09],
      [-94.58, 39.09],
    ]);
    // A state-plane system is not converted — better flat than in the wrong place.
    expect(cornersFromBBox([1000, 1000, 2000, 2000], 2263)).toBeNull();
    // Pixel coordinates labelled as lat/lng are not a place on Earth.
    expect(cornersFromBBox([0, 0, 6000, 4000], 4326)).toBeNull();
  });
});

describe("measuring on the map", () => {
  it("measures distance and area", () => {
    // One degree of latitude is about 111.2 km.
    expect(distanceMeters([0, 0], [0, 1]) / 1000).toBeCloseTo(111.19, 1);
    // A 100 m x 100 m square near Kansas City is about 10,000 m².
    const { easting, northing } = lngLatToUtm(-94.5786, 39.0997, 15);
    const corner = (de: number, dn: number) => utmToLngLat(easting + de, northing + dn, 15, false);
    const square = [corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100)];
    expect(polygonAreaSquareMeters(square)).toBeGreaterThan(9900);
    expect(polygonAreaSquareMeters(square)).toBeLessThan(10100);
  });

  it("says it in units a US property manager uses", () => {
    expect(formatLength(30.48)).toBe("100 ft (30.5 m)");
    expect(formatArea(92.903)).toBe("1,000 sq ft (93 m²)");
    expect(formatArea(8093.7128)).toBe("2.00 acres (87,120 sq ft)");
  });
});
