import { describe, expect, it } from "vitest";
import { normaliseArea, normaliseColor, pointProblem, ringCentre } from "@/lib/annotation-validation";
import { embedFrameSrc } from "@/lib/embed-url";

describe("pointProblem", () => {
  it("accepts a real position and names an impossible one", () => {
    expect(pointProblem(38.6, -90.2)).toBeNull();
    expect(pointProblem(91, 0)).toMatch(/Latitude/);
    expect(pointProblem(0, -181)).toMatch(/Longitude/);
    expect(pointProblem(Number.NaN, 0)).toMatch(/Latitude/);
  });
});

describe("normaliseArea", () => {
  const square = [
    [-90.2, 38.6],
    [-90.1, 38.6],
    [-90.1, 38.7],
    [-90.2, 38.7],
  ];

  it("keeps an open ring as it is", () => {
    expect(normaliseArea(square)).toEqual({ ring: square });
  });

  it("opens a ring sent closed, the way GeoJSON writes it", () => {
    expect(normaliseArea([...square, square[0]])).toEqual({ ring: square });
  });

  it("needs three distinct corners", () => {
    expect(normaliseArea(square.slice(0, 2))).toHaveProperty("problem");
    // Three corners, two of them the same point, is a line.
    expect(normaliseArea([square[0], square[1], square[1]])).toHaveProperty("problem");
  });

  it("refuses corners that are not [longitude, latitude]", () => {
    expect(normaliseArea([[0, 0], [1, 1], ["x", 2]])).toHaveProperty("problem");
    expect(normaliseArea([[0, 0], [1, 1], [200, 2]])).toHaveProperty("problem");
    expect(normaliseArea("not a ring")).toHaveProperty("problem");
  });

  it("finds the middle of the area for its label pin", () => {
    expect(ringCentre(square as [number, number][])).toEqual([-90.15000000000001, 38.650000000000006]);
  });
});

describe("normaliseColor", () => {
  it("keeps a hex colour and drops anything else", () => {
    expect(normaliseColor("#16A34A")).toBe("#16a34a");
    expect(normaliseColor("red")).toBeNull();
    expect(normaliseColor("#fff")).toBeNull();
    expect(normaliseColor(null)).toBeNull();
  });
});

describe("embedFrameSrc", () => {
  it("turns YouTube and Vimeo share links into their players", () => {
    expect(embedFrameSrc("VIDEO", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedFrameSrc("VIDEO", "https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedFrameSrc("VIDEO", "https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedFrameSrc("VIDEO", "https://vimeo.com/123456789")).toBe("https://player.vimeo.com/video/123456789");
  });

  it("leaves other links, and other kinds, as given", () => {
    expect(embedFrameSrc("VIDEO", "https://cdn.example.com/walkthrough.mp4")).toBe("https://cdn.example.com/walkthrough.mp4");
    expect(embedFrameSrc("OTHER", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(embedFrameSrc("VIDEO", "https://www.youtube.com/watch?v=<script>")).toBe("https://www.youtube.com/watch?v=<script>");
  });
});
