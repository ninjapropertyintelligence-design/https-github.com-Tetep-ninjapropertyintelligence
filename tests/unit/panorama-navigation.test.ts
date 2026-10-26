import { describe, expect, it } from "vitest";
import { bearingDegrees, effectiveHeadings, panoramaLinks, type NavPanorama } from "@/lib/media/panorama-navigation";
import { readPanoramaMetadata } from "@/lib/media/panorama-metadata";

// About 11 m per 0.0001° of latitude here; longitude a little less.
const at = (id: string, lat: number, lng: number, capturedAt: string, heading: number | null = null): NavPanorama => ({
  id,
  label: id,
  latitude: lat,
  longitude: lng,
  heading,
  capturedAt,
});

describe("bearingDegrees", () => {
  it("points north, east, south and west", () => {
    expect(bearingDegrees(38, -90, 38.001, -90)).toBeCloseTo(0, 1);
    expect(bearingDegrees(38, -90, 38, -89.999)).toBeCloseTo(90, 1);
    expect(bearingDegrees(38, -90, 37.999, -90)).toBeCloseTo(180, 1);
    expect(bearingDegrees(38, -90, 38, -90.001)).toBeCloseTo(270, 1);
  });
});

describe("panoramaLinks", () => {
  const a = at("a", 38.6, -90.2, "2026-10-01T10:00:00Z");
  const north = at("north", 38.6001, -90.2, "2026-10-01T10:01:00Z");
  const fartherNorth = at("farther-north", 38.6002, -90.2, "2026-10-01T10:02:00Z");
  const east = at("east", 38.6, -90.1999, "2026-10-01T10:03:00Z");
  const faraway = at("faraway", 38.61, -90.2, "2026-10-01T10:04:00Z");
  const noGps = { ...at("no-gps", 0, 0, "2026-10-01T10:05:00Z"), latitude: null, longitude: null };

  it("links nearby panoramas, one arrow per direction (the nearest)", () => {
    const links = panoramaLinks(a, [a, north, fartherNorth, east, faraway, noGps]);
    expect(links.map((l) => l.id).sort()).toEqual(["east", "north"]);
    expect(links.find((l) => l.id === "north")!.bearing).toBeCloseTo(0, 0);
    expect(links.find((l) => l.id === "east")!.bearing).toBeCloseTo(90, 0);
  });

  it("has nothing to link from a panorama without GPS", () => {
    expect(panoramaLinks(noGps, [a, north])).toEqual([]);
  });
});

describe("effectiveHeadings", () => {
  it("keeps a recorded heading and estimates the rest from the walk", () => {
    const first = at("first", 38.6, -90.2, "2026-10-01T10:00:00Z");
    const second = at("second", 38.6001, -90.2, "2026-10-01T10:01:00Z");
    const third = at("third", 38.6001, -90.1999, "2026-10-01T10:02:00Z", 45);
    const headings = effectiveHeadings([third, first, second]);
    // The first faces towards the second (north); the second faces the way it was walked into (north).
    expect(headings.get("first")!.heading).toBeCloseTo(0, 0);
    expect(headings.get("first")!.estimated).toBe(true);
    expect(headings.get("second")!.heading).toBeCloseTo(0, 0);
    expect(headings.get("third")).toEqual({ heading: 45, estimated: false });
  });
});

describe("readPanoramaMetadata heading", () => {
  it("reads GPano:PoseHeadingDegrees from XMP", () => {
    const xmp = `<x:xmpmeta><rdf:Description GPano:ProjectionType="equirectangular" GPano:PoseHeadingDegrees="123.5"/></x:xmpmeta>`;
    const app1 = new TextEncoder().encode(`http://ns.adobe.com/xap/1.0/\0${xmp}`);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff, ...app1, 0xff, 0xd9]);
    expect(readPanoramaMetadata(bytes).heading).toBe(123.5);
  });
});
