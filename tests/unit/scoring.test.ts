import { describe, expect, it } from "vitest";
import { healthBandFor, DEFAULT_CATEGORY_WEIGHTS, SCORING_CATEGORIES, inferCategoryFromAssetType } from "@/lib/scoring-categories";

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
