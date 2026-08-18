/**
 * Canonical scoring categories (spec §7). Weights are configuration, not
 * code — `ScoringCategoryWeight` rows with organizationId=null are the
 * platform defaults; a row with an organizationId overrides one category for
 * that org. Nothing in the scoring engine hard-codes a percentage.
 */
export const SCORING_CATEGORIES = [
  "Roof",
  "HVAC",
  "Electrical",
  "Plumbing",
  "FireLifeSafety",
  "Interior",
  "ExteriorParking",
  "Issues",
] as const;

export type ScoringCategory = (typeof SCORING_CATEGORIES)[number];

export const DEFAULT_CATEGORY_WEIGHTS: Record<ScoringCategory, number> = {
  Roof: 15,
  HVAC: 20,
  Electrical: 15,
  Plumbing: 10,
  FireLifeSafety: 15,
  Interior: 10,
  ExteriorParking: 10,
  Issues: 5,
};

export const HEALTH_BANDS = [
  { min: 90, max: 100, label: "Excellent" },
  { min: 80, max: 89, label: "Good" },
  { min: 65, max: 79, label: "Needs Attention" },
  { min: 50, max: 64, label: "Poor" },
  { min: 0, max: 49, label: "Critical" },
] as const;

export type HealthBandLabel = (typeof HEALTH_BANDS)[number]["label"];

export function healthBandFor(score: number): HealthBandLabel {
  for (const band of HEALTH_BANDS) {
    if (score >= band.min && score <= band.max) return band.label;
  }
  return "Critical";
}

const ASSET_TYPE_KEYWORDS: Array<[RegExp, ScoringCategory]> = [
  // HVAC is checked before Roof: rooftop units ("RTU", "rooftop") mention
  // "roof" but are HVAC equipment, not the roof membrane/system itself.
  [/(hvac|rtu|chiller|furnace|air.?handler|condenser|heat.?pump|rooftop unit)/i, "HVAC"],
  [/roof/i, "Roof"],
  [/(electrical|panel|switchgear|transformer|generator|breaker)/i, "Electrical"],
  [/(plumb|water.?heater|sewer|backflow|pump)/i, "Plumbing"],
  [/(fire|sprinkler|alarm|extinguisher|life.?safety)/i, "FireLifeSafety"],
  [/(floor|ceiling|wall|interior|paint|carpet|restroom)/i, "Interior"],
  [/(parking|lot|sidewalk|facade|exterior|landscap|signage|lighting)/i, "ExteriorParking"],
];

/** Best-effort category inference for assets not linked to a BuildingSystem. */
export function inferCategoryFromAssetType(assetType: string): ScoringCategory | null {
  for (const [pattern, category] of ASSET_TYPE_KEYWORDS) {
    if (pattern.test(assetType)) return category;
  }
  return null;
}
