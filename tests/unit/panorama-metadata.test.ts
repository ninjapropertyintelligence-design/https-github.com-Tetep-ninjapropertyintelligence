import { describe, expect, it } from "vitest";
import {
  classifyPanorama,
  distanceMeters,
  parseExifDate,
  readPanoramaMetadata,
  type PanoramaMetadata,
} from "@/lib/media/panorama-metadata";

/**
 * Builds a minimal but structurally real JPEG: SOI, an EXIF APP1 (IFD0 with
 * Make/Model and pointers to an Exif IFD and a GPS IFD), an optional XMP
 * APP1, a SOF0 frame header and EOI. Big-endian ("MM") so byte order is
 * exercised on the path most parsers get wrong.
 */
function buildJpeg(opts: {
  width: number;
  height: number;
  date?: string;
  offset?: string;
  gps?: { lat: [number, number, number]; latRef: string; lng: [number, number, number]; lngRef: string };
  xmpProjection?: string;
  littleEndian?: boolean;
}): Uint8Array {
  const le = opts.littleEndian ?? false;
  const tiff: number[] = [];
  const u16 = (v: number) => (le ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]);
  const u32 = (v: number) =>
    le
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]
      : [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);

  // Layout: header(8) | IFD0 | ExifIFD | GPSIFD | data area
  const make = ascii("Arashi Vision");
  const model = ascii("Insta360 X4");
  const date = opts.date ? ascii(opts.date) : null;
  const offset = opts.offset ? ascii(opts.offset) : null;

  const ifd0Count = 4;
  const exifCount = (date ? 1 : 0) + (offset ? 1 : 0);
  const gpsCount = opts.gps ? 4 : 0;
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(ifd0Count);
  const gpsAt = exifAt + ifdSize(exifCount);
  const dataAt = gpsAt + ifdSize(gpsCount);
  const data: number[] = [];
  const place = (bytes: number[]) => {
    const at = dataAt + data.length;
    data.push(...bytes);
    return at;
  };

  const entry = (tag: number, type: number, count: number, value: number[]) => [
    ...u16(tag),
    ...u16(type),
    ...u32(count),
    ...value,
  ];
  const ptr = (at: number) => u32(at);

  const ifd0 = [
    ...u16(ifd0Count),
    ...entry(0x010f, 2, make.length, ptr(place(make))),
    ...entry(0x0110, 2, model.length, ptr(place(model))),
    ...entry(0x8769, 4, 1, u32(exifAt)),
    ...entry(0x8825, 4, 1, u32(opts.gps ? gpsAt : 0)),
    ...u32(0),
  ];
  const exif = [
    ...u16(exifCount),
    ...(date ? entry(0x9003, 2, date.length, ptr(place(date))) : []),
    ...(offset ? entry(0x9011, 2, offset.length, ptr(place(offset))) : []),
    ...u32(0),
  ];
  const rational3 = (v: [number, number, number]) => v.flatMap((n) => [...u32(Math.round(n * 1000)), ...u32(1000)]);
  const gps = opts.gps
    ? [
        ...u16(gpsCount),
        ...entry(0x0001, 2, 2, [opts.gps.latRef.charCodeAt(0), 0, 0, 0]),
        ...entry(0x0002, 5, 3, ptr(place(rational3(opts.gps.lat)))),
        ...entry(0x0003, 2, 2, [opts.gps.lngRef.charCodeAt(0), 0, 0, 0]),
        ...entry(0x0004, 5, 3, ptr(place(rational3(opts.gps.lng)))),
        ...u32(0),
      ]
    : [...u16(0), ...u32(0)];

  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifd0At), ...ifd0, ...exif, ...gps, ...data);

  const segment = (marker: number, payload: number[]) => {
    const len = payload.length + 2;
    return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
  };
  const exifPayload = [...ascii("Exif").concat(0), ...tiff];
  const out: number[] = [0xff, 0xd8, ...segment(0xe1, exifPayload)];
  if (opts.xmpProjection) {
    const xml = `<x:xmpmeta><rdf:Description GPano:ProjectionType="${opts.xmpProjection}"/></x:xmpmeta>`;
    out.push(...segment(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), ...[...xml].map((c) => c.charCodeAt(0))]));
  }
  // SOF0: precision, height, width, components
  out.push(
    ...segment(0xc0, [8, (opts.height >> 8) & 0xff, opts.height & 0xff, (opts.width >> 8) & 0xff, opts.width & 0xff, 3]),
  );
  out.push(0xff, 0xd9);
  return new Uint8Array(out);
}

describe("readPanoramaMetadata", () => {
  it("reads dimensions, camera, capture time with offset, GPS and projection", () => {
    const meta = readPanoramaMetadata(
      buildJpeg({
        width: 11904,
        height: 5952,
        date: "2026:09:14 10:30:00",
        offset: "-05:00",
        gps: { lat: [32, 46, 36.12], latRef: "N", lng: [96, 47, 49.2], lngRef: "W" },
        xmpProjection: "equirectangular",
      }),
    );
    expect(meta.width).toBe(11904);
    expect(meta.height).toBe(5952);
    expect(meta.make).toBe("Arashi Vision");
    expect(meta.model).toBe("Insta360 X4");
    expect(meta.capturedAt?.toISOString()).toBe("2026-09-14T15:30:00.000Z");
    expect(meta.latitude).toBeCloseTo(32.7767, 3);
    expect(meta.longitude).toBeCloseTo(-96.797, 3);
    expect(meta.projection).toBe("equirectangular");
  });

  it("handles little-endian EXIF and southern/eastern hemispheres", () => {
    const meta = readPanoramaMetadata(
      buildJpeg({
        width: 4000,
        height: 2000,
        littleEndian: true,
        gps: { lat: [33, 52, 4], latRef: "S", lng: [151, 12, 26], lngRef: "E" },
      }),
    );
    expect(meta.latitude).toBeCloseTo(-33.8678, 3);
    expect(meta.longitude).toBeCloseTo(151.2072, 3);
  });

  it("returns empty metadata for non-JPEG and truncated input instead of throwing", () => {
    expect(readPanoramaMetadata(new Uint8Array([0x89, 0x50, 0x4e, 0x47])).width).toBeNull();
    const full = buildJpeg({ width: 4000, height: 2000, date: "2026:01:01 00:00:00" });
    for (const cut of [3, 10, 40, full.length - 5]) {
      expect(() => readPanoramaMetadata(full.subarray(0, cut))).not.toThrow();
    }
  });
});

describe("parseExifDate", () => {
  it("rejects unset and malformed dates", () => {
    expect(parseExifDate("0000:00:00 00:00:00", null)).toBeNull();
    expect(parseExifDate("yesterday", null)).toBeNull();
    expect(parseExifDate(null, null)).toBeNull();
  });
});

describe("classifyPanorama", () => {
  const meta = (m: Partial<PanoramaMetadata>): PanoramaMetadata => ({
    width: null,
    height: null,
    capturedAt: null,
    latitude: null,
    longitude: null,
    make: null,
    model: null,
    projection: null,
    ...m,
  });

  it("names Insta360 originals instead of calling them broken", () => {
    const result = classifyPanorama("IMG_20260914_103000_00_001.insp", null);
    expect(result.kind).toBe("NEEDS_EXPORT");
    expect(classifyPanorama("VID_001.insv", null).kind).toBe("NEEDS_EXPORT");
  });

  it("accepts an equirectangular tag or a 2:1 frame, and rejects an ordinary photo", () => {
    expect(classifyPanorama("a.jpg", meta({ width: 5000, height: 3000, projection: "equirectangular" })).kind).toBe("PANORAMA");
    expect(classifyPanorama("b.JPG", meta({ width: 6080, height: 3040 })).kind).toBe("PANORAMA");
    expect(classifyPanorama("c.jpg", meta({ width: 4032, height: 3024 })).kind).toBe("NOT_PANORAMA");
    expect(classifyPanorama("d.jpg", meta({ width: 6080, height: 3040, projection: "cylindrical" })).kind).toBe("NOT_PANORAMA");
    expect(classifyPanorama("e.png", meta({ width: 6080, height: 3040 })).kind).toBe("NOT_PANORAMA");
  });
});

describe("distanceMeters", () => {
  it("is roughly right over a city block and zero at the same point", () => {
    expect(distanceMeters(32.7767, -96.797, 32.7767, -96.797)).toBe(0);
    const d = distanceMeters(32.7767, -96.797, 32.7857, -96.797); // ~0.009° of latitude
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });
});
