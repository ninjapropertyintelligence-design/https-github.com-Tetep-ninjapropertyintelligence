import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizePixelBox, parseStoredBox } from "@/lib/ai/bounding-box";
import { FindingImageOverlay } from "@/components/ai/FindingImageOverlay";

/**
 * A box is only useful if it lands on the defect. Every way it can drift —
 * mistaking a centre for a corner, pixels stored as fractions, a cropped
 * image — draws a confident rectangle in the wrong place, which is worse
 * than drawing none. These tests pin each of those down.
 */

describe("normalizePixelBox", () => {
  it("converts a Roboflow centre-origin pixel box to top-left fractions", () => {
    // The example payload: centre (120, 340), 50 x 45, on a 640 x 480 photo.
    const box = normalizePixelBox({ x: 120, y: 340, width: 50, height: 45 }, 640, 480, "center")!;
    expect(box.x).toBeCloseTo(95 / 640);
    expect(box.y).toBeCloseTo(317.5 / 480);
    expect(box.w).toBeCloseTo(50 / 640);
    expect(box.h).toBeCloseTo(45 / 480);
  });

  it("reads the same numbers differently for a top-left detector", () => {
    const box = normalizePixelBox({ x: 120, y: 340, width: 50, height: 45 }, 640, 480, "top-left")!;
    expect(box.x).toBeCloseTo(120 / 640);
    expect(box.y).toBeCloseTo(340 / 480);
  });

  it("clips a box that spills off the edge of the image", () => {
    const box = normalizePixelBox({ x: 600, y: 10, width: 100, height: 40 }, 640, 480, "top-left")!;
    expect(box.x).toBeCloseTo(600 / 640);
    expect(box.x + box.w).toBeCloseTo(1);
  });

  it("gives null for a box with no area, off the image, or with no image size", () => {
    expect(normalizePixelBox({ x: 10, y: 10, width: 0, height: 5 }, 640, 480, "top-left")).toBeNull();
    expect(normalizePixelBox({ x: 900, y: 10, width: 50, height: 50 }, 640, 480, "top-left")).toBeNull();
    expect(normalizePixelBox({ x: 10, y: 10, width: 50, height: 50 }, 0, 480, "top-left")).toBeNull();
    expect(normalizePixelBox({ x: Number.NaN, y: 10, width: 50, height: 50 }, 640, 480, "top-left")).toBeNull();
  });
});

describe("parseStoredBox", () => {
  it("accepts a well-formed normalized box", () => {
    expect(parseStoredBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });

  it("refuses pixel values rather than guessing an image size", () => {
    expect(parseStoredBox({ x: 120, y: 340, w: 50, h: 45 })).toBeNull();
  });

  it("refuses anything that is not a complete box", () => {
    expect(parseStoredBox(null)).toBeNull();
    expect(parseStoredBox([0.1, 0.2, 0.3, 0.4])).toBeNull();
    expect(parseStoredBox({ x: 0.1, y: 0.2, w: 0.3 })).toBeNull();
    expect(parseStoredBox({ x: "0.1", y: 0.2, w: 0.3, h: 0.4 })).toBeNull();
    expect(parseStoredBox({ x: 0.1, y: 0.2, w: 0, h: 0.4 })).toBeNull();
  });

  it("clips a box that runs past the right or bottom edge", () => {
    const box = parseStoredBox({ x: 0.9, y: 0.5, w: 0.3, h: 0.2 })!;
    expect(box.w).toBeCloseTo(0.1);
  });
});

describe("FindingImageOverlay", () => {
  const box = { x: 0.25, y: 0.5, w: 0.1, h: 0.2 };

  it("positions each box in percent of the image, so it holds at any display size", () => {
    const html = renderToStaticMarkup(
      <FindingImageOverlay
        src="/photo.jpg"
        alt="Roof"
        imageWidth={640}
        imageHeight={480}
        boxes={[{ id: "f1", box, label: "roof shingle damage 92%", severity: "HIGH", state: "pending" }]}
      />,
    );
    expect(html).toContain("left:25%");
    expect(html).toContain("top:50%");
    expect(html).toContain("width:10%");
    expect(html).toContain("height:20%");
    expect(html).toContain("roof shingle damage 92%");
  });

  it("reserves the image's aspect ratio and never crops it", () => {
    const html = renderToStaticMarkup(
      <FindingImageOverlay src="/p.jpg" alt="x" imageWidth={640} imageHeight={480} boxes={[]} />,
    );
    // Reserved before load, so the page does not jump when the photo arrives.
    expect(html).toContain("aspect-ratio:640 / 480");
    // object-cover would crop the photo and move every box off its defect.
    expect(html).not.toContain("object-cover");
  });

  it("falls back to the image's natural height when its size is unknown", () => {
    const html = renderToStaticMarkup(
      <FindingImageOverlay src="/p.jpg" alt="x" imageWidth={null} imageHeight={null} boxes={[]} />,
    );
    expect(html).not.toContain("aspect-ratio");
    expect(html).toContain("h-auto w-full");
  });

  it("describes the boxes for screen readers", () => {
    const html = renderToStaticMarkup(
      <FindingImageOverlay
        src="/p.jpg"
        alt="x"
        imageWidth={10}
        imageHeight={10}
        boxes={[{ id: "f1", box, label: "pavement crack", severity: "MEDIUM", state: "confirmed" }]}
      />,
    );
    expect(html).toContain("Confirmed: pavement crack");
  });
});
