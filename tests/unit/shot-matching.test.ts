import { describe, expect, it } from "vitest";
import {
  GPS_MATCH_RADIUS_METERS,
  matchPhotosToShots,
  parseLatLng,
  type PhotoToMatch,
  type ShotTarget,
} from "@/lib/capture/shot-matching";

// A site in Kansas City. 0.0001° of latitude is ~11 m.
const LAT = 39.0997;
const LNG = -94.5786;

function shot(id: string, sequence: number, pin: [number, number] | null, captured = false): ShotTarget {
  return { id, label: id, sequence, latitude: pin?.[0] ?? null, longitude: pin?.[1] ?? null, captured };
}

function photo(key: string, at: [number, number] | null, time: string | null, filename = `${key}.jpg`): PhotoToMatch {
  return {
    key,
    filename,
    latitude: at?.[0] ?? null,
    longitude: at?.[1] ?? null,
    capturedAt: time ? new Date(time) : null,
  };
}

describe("matching by GPS", () => {
  const route = [
    shot("entrance", 1, [LAT, LNG]),
    shot("north-lot", 2, [LAT + 0.0009, LNG]), // ~100 m north
    shot("roof", 3, [LAT, LNG + 0.0012]), // ~100 m east
  ];

  it("files each geotagged photo to the nearest pin within the radius, whatever order it was shot in", () => {
    const result = matchPhotosToShots(
      [
        photo("a", [LAT + 0.00091, LNG + 0.00002], "2026-10-08T10:00:00Z"),
        photo("b", [LAT + 0.00003, LNG], "2026-10-08T10:05:00Z"),
        photo("c", [LAT, LNG + 0.00118], "2026-10-08T10:10:00Z"),
      ],
      route,
    );
    expect(result.get("a")).toMatchObject({ shotId: "north-lot", method: "GPS" });
    expect(result.get("b")).toMatchObject({ shotId: "entrance", method: "GPS" });
    expect(result.get("c")).toMatchObject({ shotId: "roof", method: "GPS" });
    expect((result.get("b") as { distanceMeters: number }).distanceMeters).toBeLessThan(5);
  });

  it("refuses to force a photo onto a pin it is far from", () => {
    const result = matchPhotosToShots([photo("stray", [LAT + 0.0004, LNG + 0.0006], null)], route);
    expect(result.get("stray")).toMatchObject({ shotId: null });
    expect((result.get("stray") as { reason: string }).reason).toContain(`${GPS_MATCH_RADIUS_METERS} m`);
  });

  it("lets two retakes at the same spot both land on that position", () => {
    const result = matchPhotosToShots(
      [photo("t1", [LAT, LNG], null), photo("t2", [LAT + 0.00001, LNG], null)],
      route,
    );
    expect(result.get("t1")?.shotId).toBe("entrance");
    expect(result.get("t2")?.shotId).toBe("entrance");
  });
});

describe("matching by walking order", () => {
  const route = [shot("s1", 1, null), shot("s2", 2, null), shot("s3", 3, null)];

  it("pairs photos with positions in route order when the counts line up", () => {
    const result = matchPhotosToShots(
      [
        photo("late", null, "2026-10-08T10:20:00Z"),
        photo("early", null, "2026-10-08T10:00:00Z"),
        photo("mid", null, "2026-10-08T10:10:00Z"),
      ],
      route,
    );
    expect(result.get("early")).toEqual({ shotId: "s1", method: "ORDER" });
    expect(result.get("mid")).toEqual({ shotId: "s2", method: "ORDER" });
    expect(result.get("late")).toEqual({ shotId: "s3", method: "ORDER" });
  });

  it("falls back to Insta360's time-stamped filenames when there is no capture time", () => {
    const result = matchPhotosToShots(
      [
        photo("x", null, null, "IMG_20261008_102000_00_002.jpg"),
        photo("y", null, null, "IMG_20261008_101500_00_001.jpg"),
        photo("z", null, null, "IMG_20261008_103000_00_010.jpg"),
      ],
      route,
    );
    expect(result.get("y")?.shotId).toBe("s1");
    expect(result.get("x")?.shotId).toBe("s2");
    expect(result.get("z")?.shotId).toBe("s3");
  });

  it("assigns nothing when the counts differ, rather than guessing", () => {
    const result = matchPhotosToShots(
      [photo("a", null, "2026-10-08T10:00:00Z"), photo("b", null, "2026-10-08T10:05:00Z")],
      route,
    );
    expect(result.get("a")?.shotId).toBeNull();
    expect(result.get("b")?.shotId).toBeNull();
    expect((result.get("a") as { reason: string }).reason).toMatch(/2 photos for 3 remaining positions/);
  });

  it("skips positions already captured on an earlier upload", () => {
    const partlyDone = [shot("s1", 1, null, true), shot("s2", 2, null), shot("s3", 3, null)];
    const result = matchPhotosToShots(
      [photo("a", null, "2026-10-08T10:00:00Z"), photo("b", null, "2026-10-08T10:05:00Z")],
      partlyDone,
    );
    expect(result.get("a")?.shotId).toBe("s2");
    expect(result.get("b")?.shotId).toBe("s3");
  });
});

describe("GPS and order together", () => {
  it("matches what GPS can, then pairs the rest by order", () => {
    const route = [shot("pinned", 1, [LAT, LNG]), shot("u2", 2, null), shot("u3", 3, null)];
    const result = matchPhotosToShots(
      [
        photo("gps", [LAT, LNG], "2026-10-08T10:00:00Z"),
        photo("n1", null, "2026-10-08T10:05:00Z"),
        photo("n2", null, "2026-10-08T10:10:00Z"),
      ],
      route,
    );
    expect(result.get("gps")).toMatchObject({ shotId: "pinned", method: "GPS" });
    expect(result.get("n1")).toEqual({ shotId: "u2", method: "ORDER" });
    expect(result.get("n2")).toEqual({ shotId: "u3", method: "ORDER" });
  });

  it("abandons an order pairing that the GPS contradicts", () => {
    // Two positions; the photos have GPS, but only the second position is pinned
    // and the photo the order would give it was taken ~100 m away.
    const route = [shot("u1", 1, null), shot("pinned", 2, [LAT, LNG])];
    const result = matchPhotosToShots(
      [photo("a", null, "2026-10-08T10:00:00Z"), photo("b", [LAT + 0.0009, LNG], "2026-10-08T10:05:00Z")],
      route,
    );
    expect(result.get("a")?.shotId).toBeNull();
    expect(result.get("b")?.shotId).toBeNull();
  });

  it("says so when the site has no route", () => {
    expect(matchPhotosToShots([photo("a", null, null)], []).get("a")).toMatchObject({ shotId: null });
  });
});

describe("parseLatLng", () => {
  it("reads what Google Maps copies, and flags typos", () => {
    expect(parseLatLng("39.0997, -94.5786")).toEqual({ latitude: 39.0997, longitude: -94.5786 });
    expect(parseLatLng("(39.0997,-94.5786)")).toEqual({ latitude: 39.0997, longitude: -94.5786 });
    expect(parseLatLng("39.0997 -94.5786")).toEqual({ latitude: 39.0997, longitude: -94.5786 });
    expect(parseLatLng("")).toBeNull();
    expect(parseLatLng("north lot")).toBe("invalid");
    expect(parseLatLng("-94.5786, 139.0997")).toBe("invalid");
  });
});
