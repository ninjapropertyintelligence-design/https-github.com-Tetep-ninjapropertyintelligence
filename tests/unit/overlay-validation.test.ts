import { describe, expect, it } from "vitest";
import { boundsProblem, boundsToCorners, parseGeoJson } from "@/lib/overlay-validation";

const site = { north: 39.101, south: 39.099, east: -94.577, west: -94.58 };

describe("boundsProblem", () => {
  it("accepts a site-sized box", () => {
    expect(boundsProblem(site)).toBeNull();
  });

  it("catches swapped edges, which Mapbox would draw inside out", () => {
    expect(boundsProblem({ ...site, north: site.south, south: site.north })).toMatch(/north edge/);
    expect(boundsProblem({ ...site, east: site.west, west: site.east })).toMatch(/east edge/);
  });

  it("catches missing and out-of-range edges", () => {
    expect(boundsProblem({ north: 1, south: 0, east: 1 })).toMatch(/needs north, south, east and west/);
    expect(boundsProblem({ ...site, north: 91 })).toMatch(/between -90 and 90/);
    expect(boundsProblem({ ...site, west: -181 })).toMatch(/between -180 and 180/);
  });

  it("catches latitude and longitude typed into each other's boxes", () => {
    expect(boundsProblem({ north: 39.1, south: 30, east: -94.5, west: -94.6 })).toMatch(/far more than one site/);
  });
});

describe("boundsToCorners", () => {
  it("orders corners top-left, top-right, bottom-right, bottom-left", () => {
    expect(boundsToCorners(site)).toEqual([
      [-94.58, 39.101],
      [-94.577, 39.101],
      [-94.577, 39.099],
      [-94.58, 39.099],
    ]);
  });
});

describe("parseGeoJson", () => {
  it("counts features in a collection", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } },
        { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [] } },
      ],
    };
    expect(parseGeoJson(JSON.stringify(fc))).toEqual({ ok: true, features: 2 });
  });

  it("accepts a bare feature or geometry", () => {
    expect(parseGeoJson(JSON.stringify({ type: "LineString", coordinates: [] }))).toEqual({ ok: true, features: 1 });
  });

  it("names what is wrong", () => {
    expect(parseGeoJson("{not json")).toEqual({ ok: false, problem: "The file is not valid JSON" });
    expect(parseGeoJson(JSON.stringify({ type: "Topology" }))).toMatchObject({ ok: false });
    const bad = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Circle" } }] };
    expect(parseGeoJson(JSON.stringify(bad))).toEqual({ ok: false, problem: "Feature 1 has no recognisable geometry" });
  });
});
