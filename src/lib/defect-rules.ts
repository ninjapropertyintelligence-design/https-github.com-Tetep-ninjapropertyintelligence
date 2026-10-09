import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { SCORING_CATEGORIES, type ScoringCategory } from "@/lib/scoring-categories";
import type { IssueSeverity } from "@/generated/prisma/client";

/**
 * DEFECT RULES — what a CONFIRMED AI finding does to the numbers.
 *
 * The detector (a vision LLM today, Roboflow later) only names a defect
 * class. Everything that follows from it — the issue's severity, the points
 * taken off the asset's condition, the repair estimate that lands in capital
 * exposure — comes from this rulebook, never from the model. Same input,
 * same numbers, every time, and every number traceable to a rule.
 *
 * Arrangement mirrors scoring weights: the platform defaults below are code,
 * an organization's changes are `DefectRule` rows that override one class.
 */

export interface DefectRuleValues {
  defectClass: string;
  category: ScoringCategory;
  defaultSeverity: IssueSeverity;
  /** Points subtracted from the asset's condition score. */
  conditionHit: number;
  /**
   * Repair estimate in cents, or null when none has been set. Null is not
   * zero: a confirmed finding with no estimate opens an issue that SAYS it
   * has no estimate and adds nothing to capital exposure, where zero would
   * claim the repair is free.
   */
  repairCostCents: number | null;
}

export interface EffectiveDefectRule extends DefectRuleValues {
  /** "organization" when this org has overridden the platform default. */
  source: "platform" | "organization";
}

/**
 * The platform's starting rulebook. Class names are snake_case and stable —
 * they are the contract with whatever detector is plugged in.
 *
 * NO REPAIR COSTS, deliberately. There is no sourced figure to put here:
 * repair prices vary by region, building and contract, and a plausible
 * number invented in code would flow into capital exposure — which lenders
 * and insurers read — looking exactly like a real estimate. Each
 * organization sets its own on the Defect Rules page; until it does,
 * confirmed findings open issues with no estimate.
 *
 * The condition points ARE defaults: a judgement call, not a standard, shown
 * to the inspector before every confirmation and editable per organization.
 */
export const DEFAULT_DEFECT_RULES: readonly DefectRuleValues[] = [
  { defectClass: "roof_shingle_damage", category: "Roof", defaultSeverity: "HIGH", conditionHit: 25, repairCostCents: null },
  { defectClass: "roof_membrane_damage", category: "Roof", defaultSeverity: "HIGH", conditionHit: 20, repairCostCents: null },
  { defectClass: "roof_ponding_water", category: "Roof", defaultSeverity: "MEDIUM", conditionHit: 10, repairCostCents: null },
  { defectClass: "hvac_corrosion", category: "HVAC", defaultSeverity: "MEDIUM", conditionHit: 15, repairCostCents: null },
  { defectClass: "hvac_physical_damage", category: "HVAC", defaultSeverity: "HIGH", conditionHit: 25, repairCostCents: null },
  { defectClass: "electrical_hazard", category: "Electrical", defaultSeverity: "CRITICAL", conditionHit: 35, repairCostCents: null },
  { defectClass: "plumbing_leak", category: "Plumbing", defaultSeverity: "HIGH", conditionHit: 20, repairCostCents: null },
  { defectClass: "fire_safety_equipment_damage", category: "FireLifeSafety", defaultSeverity: "CRITICAL", conditionHit: 30, repairCostCents: null },
  { defectClass: "water_stain", category: "Interior", defaultSeverity: "MEDIUM", conditionHit: 10, repairCostCents: null },
  { defectClass: "interior_finish_damage", category: "Interior", defaultSeverity: "LOW", conditionHit: 5, repairCostCents: null },
  { defectClass: "pavement_crack", category: "ExteriorParking", defaultSeverity: "MEDIUM", conditionHit: 10, repairCostCents: null },
  { defectClass: "pavement_pothole", category: "ExteriorParking", defaultSeverity: "MEDIUM", conditionHit: 10, repairCostCents: null },
  { defectClass: "facade_crack", category: "ExteriorParking", defaultSeverity: "HIGH", conditionHit: 15, repairCostCents: null },
];

const DEFAULTS_BY_CLASS = new Map(DEFAULT_DEFECT_RULES.map((r) => [r.defectClass, r]));

/** Snake_case, starting with a letter: the shape detector labels arrive in. */
const DEFECT_CLASS_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

/** "Issues" is derived from open issues, not a category an asset or defect belongs to. */
const DEFECT_CATEGORIES = SCORING_CATEGORIES.filter((c) => c !== "Issues");

function fromRow(row: {
  defectClass: string;
  category: string;
  defaultSeverity: IssueSeverity;
  conditionHit: number;
  repairCostCents: number | null;
}): EffectiveDefectRule {
  return { ...row, category: row.category as ScoringCategory, source: "organization" };
}

/** The rule that applies to one class in one organization, or null if none does. */
export async function resolveDefectRule(
  organizationId: string,
  defectClass: string | null | undefined,
): Promise<EffectiveDefectRule | null> {
  if (!defectClass) return null;
  const row = await prisma.defectRule.findUnique({
    where: { organizationId_defectClass: { organizationId, defectClass } },
  });
  if (row) return fromRow(row);
  const fallback = DEFAULTS_BY_CLASS.get(defectClass);
  return fallback ? { ...fallback, source: "platform" } : null;
}

/** Every class this organization has a rule for: platform defaults with its overrides applied, plus its own classes. */
export async function listEffectiveDefectRules(organizationId: string): Promise<EffectiveDefectRule[]> {
  const rows = await prisma.defectRule.findMany({ where: { organizationId } });
  const merged = new Map<string, EffectiveDefectRule>(
    DEFAULT_DEFECT_RULES.map((r) => [r.defectClass, { ...r, source: "platform" as const }]),
  );
  for (const row of rows) merged.set(row.defectClass, fromRow(row));
  return [...merged.values()].sort((a, b) => a.defectClass.localeCompare(b.defectClass));
}

export function validateDefectRule(input: DefectRuleValues): void {
  if (!DEFECT_CLASS_PATTERN.test(input.defectClass)) {
    throw new ApiError(400, "Defect class must be snake_case, e.g. roof_shingle_damage");
  }
  if (!(DEFECT_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new ApiError(400, `Category must be one of: ${DEFECT_CATEGORIES.join(", ")}`);
  }
  if (!Number.isInteger(input.conditionHit) || input.conditionHit < 0 || input.conditionHit > 100) {
    throw new ApiError(400, "Condition hit must be a whole number from 0 to 100");
  }
  if (input.repairCostCents !== null && (!Number.isInteger(input.repairCostCents) || input.repairCostCents < 0)) {
    throw new ApiError(400, "Repair cost must be empty or a non-negative whole number of cents");
  }
}

export async function upsertDefectRule(organizationId: string, userId: string, input: DefectRuleValues) {
  validateDefectRule(input);
  const data = {
    category: input.category,
    defaultSeverity: input.defaultSeverity,
    conditionHit: input.conditionHit,
    repairCostCents: input.repairCostCents,
    updatedById: userId,
  };
  return prisma.defectRule.upsert({
    where: { organizationId_defectClass: { organizationId, defectClass: input.defectClass } },
    create: { organizationId, defectClass: input.defectClass, ...data },
    update: data,
  });
}

/** Removes an override; a platform class falls back to its default, an org-only class stops having a rule. */
export async function deleteDefectRule(organizationId: string, defectClass: string): Promise<boolean> {
  const { count } = await prisma.defectRule.deleteMany({ where: { organizationId, defectClass } });
  return count > 0;
}
