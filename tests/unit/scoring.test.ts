import { describe, expect, it } from "vitest";
import { healthBandFor, displayBandFor, LOW_CONFIDENCE_THRESHOLD, DEFAULT_CATEGORY_WEIGHTS, SCORING_CATEGORIES, inferCategoryFromAssetType } from "@/lib/scoring-categories";

describe("healthBandFor", () => {
  it.each([
    [100, "Excellent"],
    [90, "Excellent"],
    [89, "Good"],
    [80, "Good"],
    [79, "Needs Attention"],
    [65, "Needs Attention"],
    [64, "Poor"],
    [50, "Poor"],
    [49, "Critical"],
    [0, "Critical"],
  ])("bands score %i as %s", (score, expected) => {
    expect(healthBandFor(score)).toBe(expected);
  });
});

describe("displayBandFor", () => {
  it("withholds the band when the score rests on too little data", () => {
    // The case that read as "Health 96 · Confidence 6% · Excellent".
    expect(displayBandFor(96, 6)).toBe("Not enough data");
    expect(displayBandFor(30, LOW_CONFIDENCE_THRESHOLD - 0.1)).toBe("Not enough data");
  });

  it("shows the score's band once confidence reaches the threshold", () => {
    expect(displayBandFor(96, LOW_CONFIDENCE_THRESHOLD)).toBe("Excellent");
    expect(displayBandFor(58.2, 65)).toBe("Poor");
  });
});

describe("default category weights", () => {
  it("sums to 100", () => {
    const sum = SCORING_CATEGORIES.reduce((s, c) => s + DEFAULT_CATEGORY_WEIGHTS[c], 0);
    expect(sum).toBe(100);
  });
});

describe("inferCategoryFromAssetType", () => {
  it("maps common asset type strings to categories", () => {
    expect(inferCategoryFromAssetType("Rooftop RTU-04")).toBe("HVAC");
    expect(inferCategoryFromAssetType("Membrane Roof - East Wing")).toBe("Roof");
    expect(inferCategoryFromAssetType("Main Electrical Panel")).toBe("Electrical");
    expect(inferCategoryFromAssetType("Fire Sprinkler System")).toBe("FireLifeSafety");
    expect(inferCategoryFromAssetType("Water Heater")).toBe("Plumbing");
    expect(inferCategoryFromAssetType("Parking Lot Lighting")).toBe("ExteriorParking");
    expect(inferCategoryFromAssetType("Something Unrelated")).toBeNull();
  });
});
