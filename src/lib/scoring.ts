import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  DEFAULT_CATEGORY_WEIGHTS,
  SCORING_CATEGORIES,
  ScoringCategory,
  inferCategoryFromAssetType,
} from "@/lib/scoring-categories";

/**
 * PROPERTY HEALTH ENGINE (spec §6-§7, §32).
 *
 * This is the ONLY place property/asset health, risk, data-confidence and
 * capital-exposure numbers are calculated. The dashboard, property pages,
 * reports and the AI tool gateway all read the persisted result of this
 * service — none of them compute their own version of these numbers, and
 * the LLM never invents a score.
 */

export interface CategoryBreakdownEntry {
  score: number | null;
  weightPercent: number;
  contribution: number;
  assetCount: number;
  coveredAssetCount: number;
}

export interface PropertyHealthResult {
  healthScore: number;
  riskScore: number;
  dataConfidenceScore: number;
  interiorScore: number | null;
  exteriorScore: number | null;
  categoryBreakdown: Record<ScoringCategory, CategoryBreakdownEntry>;
  capitalExposure12mo: number;
  capitalExposure24mo: number;
  capitalExposure36mo: number;
  capitalExposureByCategory: Record<string, number>;
}

const ISSUE_SEVERITY_PENALTY: Record<string, number> = {
  LOW: 5,
  MEDIUM: 10,
  HIGH: 20,
  CRITICAL: 35,
};

const OPEN_ISSUE_STATUSES = ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS"];

/** Org-specific weights override platform defaults per category; normalized to sum 100. */
export async function getEffectiveCategoryWeights(
  organizationId: string,
): Promise<Record<ScoringCategory, number>> {
  const overrides = await prisma.scoringCategoryWeight.findMany({
    where: { organizationId },
  });
  const weights: Record<string, number> = { ...DEFAULT_CATEGORY_WEIGHTS };
  for (const row of overrides) {
    weights[row.category] = row.weightPercent;
  }
  const sum = SCORING_CATEGORIES.reduce((s, c) => s + (weights[c] ?? 0), 0) || 1;
  const normalized: Record<string, number> = {};
  for (const c of SCORING_CATEGORIES) {
    normalized[c] = ((weights[c] ?? 0) / sum) * 100;
  }
  return normalized as Record<ScoringCategory, number>;
}

function categoryForAsset(
  assetType: string,
  systemCategory: string | null,
): ScoringCategory | null {
  if (systemCategory && (SCORING_CATEGORIES as readonly string[]).includes(systemCategory)) {
    return systemCategory as ScoringCategory;
  }
  return inferCategoryFromAssetType(assetType);
}

function assetExposureBucket(
  conditionScore: number | null,
  installedAt: Date | null,
  expectedUsefulLifeYears: number | null,
): "12" | "24" | "36" | null {
  const now = Date.now();
  let yearsPastEol: number | null = null;
  if (installedAt && expectedUsefulLifeYears) {
    const eol = new Date(installedAt).getTime() + expectedUsefulLifeYears * 365.25 * 86400000;
    yearsPastEol = (now - eol) / (365.25 * 86400000);
  }
  const poor = conditionScore !== null && conditionScore < 50;
  const critical = conditionScore !== null && conditionScore < 35;

  if (critical || (yearsPastEol !== null && yearsPastEol >= 0)) return "12";
  if (poor || (yearsPastEol !== null && yearsPastEol >= -1)) return "24";
  if ((conditionScore !== null && conditionScore < 65) || (yearsPastEol !== null && yearsPastEol >= -2)) return "36";
  return null;
}

function issueExposureBucket(severity: string, dueDate: Date | null): "12" | "24" | "36" {
  if (dueDate) {
    const monthsOut = (dueDate.getTime() - Date.now()) / (30 * 86400000);
    if (monthsOut <= 12) return "12";
    if (monthsOut <= 24) return "24";
    return "36";
  }
  if (severity === "CRITICAL") return "12";
  if (severity === "HIGH") return "24";
  return "36";
}

/** Computes (without persisting) the full health/risk/confidence/CapEx picture for a property. */
export async function computePropertyHealth(propertyId: string): Promise<PropertyHealthResult> {
  const [property, assets, openIssues, weights, latestAssessment, matterportLink, droneCapture, evidenceCount] =
    await Promise.all([
      prisma.property.findUniqueOrThrow({ where: { id: propertyId } }),
      prisma.asset.findMany({
        where: { propertyId, status: "ACTIVE" },
        include: { system: true },
      }),
      prisma.issue.findMany({
        where: { propertyId, status: { in: OPEN_ISSUE_STATUSES as never } },
      }),
      prisma.property
        .findUniqueOrThrow({ where: { id: propertyId } })
        .then((p) => getEffectiveCategoryWeights(p.organizationId)),
      prisma.assessment.findFirst({
        where: { propertyId, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
      }),
      prisma.matterportPropertyLink.findFirst({
        where: { propertyId },
        orderBy: { linkedAt: "desc" },
        include: { space: true },
      }),
      prisma.droneCapture.findFirst({
        where: { propertyId, status: "READY" },
        orderBy: { capturedAt: "desc" },
      }),
      prisma.evidence.count({ where: { propertyId } }),
    ]);

  // --- Category scores from asset condition ---------------------------------
  const byCategory = new Map<ScoringCategory, { total: number; count: number; covered: number }>();
  for (const c of SCORING_CATEGORIES) byCategory.set(c, { total: 0, count: 0, covered: 0 });

  for (const asset of assets) {
    const category = categoryForAsset(asset.assetType, asset.system?.category ?? null);
    if (!category || category === "Issues") continue;
    const bucket = byCategory.get(category)!;
    bucket.count += 1;
    if (asset.conditionScore !== null && asset.conditionScore !== undefined) {
      bucket.total += asset.conditionScore;
      bucket.covered += 1;
    }
  }

  // Issues category: derived from open issue severity, not asset condition.
  let issuesScore = 100;
  for (const issue of openIssues) {
    issuesScore -= ISSUE_SEVERITY_PENALTY[issue.severity] ?? 0;
  }
  issuesScore = Math.max(0, issuesScore);

  const categoryBreakdown = {} as Record<ScoringCategory, CategoryBreakdownEntry>;
  let weightedSum = 0;
  let coveredWeight = 0;

  for (const category of SCORING_CATEGORIES) {
    const weightPercent = weights[category];
    if (category === "Issues") {
      categoryBreakdown[category] = {
        score: issuesScore,
        weightPercent,
        contribution: (issuesScore * weightPercent) / 100,
        assetCount: 0,
        coveredAssetCount: 0,
      };
      weightedSum += issuesScore * weightPercent;
      coveredWeight += weightPercent;
      continue;
    }
    const bucket = byCategory.get(category)!;
    const score = bucket.covered > 0 ? bucket.total / bucket.covered : null;
    categoryBreakdown[category] = {
      score,
      weightPercent,
      contribution: score !== null ? (score * weightPercent) / 100 : 0,
      assetCount: bucket.count,
      coveredAssetCount: bucket.covered,
    };
    if (score !== null) {
      weightedSum += score * weightPercent;
      coveredWeight += weightPercent;
    }
  }

  // Health score normalizes over categories that actually have data, so a
  // property missing e.g. Plumbing data isn't unfairly punished in the
  // headline score — that gap instead lowers Data Confidence below.
  const healthScore = coveredWeight > 0 ? Math.round((weightedSum / coveredWeight) * 10) / 10 : 0;

  const interiorScore = categoryBreakdown.Interior.score;
  const exteriorScore = categoryBreakdown.ExteriorParking.score;

  // --- Risk score -------------------------------------------------------
  let riskBoost = 0;
  for (const asset of assets) {
    if (asset.criticalityScore >= 4 && (asset.conditionScore ?? 100) < 60) {
      riskBoost += asset.criticalityScore === 5 ? 8 : 5;
    }
  }
  for (const issue of openIssues) {
    if (issue.severity === "CRITICAL") riskBoost += 10;
    else if (issue.severity === "HIGH") riskBoost += 5;
  }
  const riskScore = Math.min(100, Math.round((100 - healthScore + riskBoost) * 10) / 10);

  // --- Data confidence ----------------------------------------------------
  const nonIssueCategories = SCORING_CATEGORIES.filter((c) => c !== "Issues");
  const coveredCategoryCount = nonIssueCategories.filter(
    (c) => categoryBreakdown[c].score !== null,
  ).length;
  const categoryCoverage = coveredCategoryCount / nonIssueCategories.length;

  const daysSince = (d: Date | null | undefined) =>
    d ? (Date.now() - new Date(d).getTime()) / 86400000 : null;

  const assessmentDays = daysSince(latestAssessment?.completedAt ?? null);
  const assessmentScore = assessmentDays === null ? 0 : assessmentDays <= 365 ? 1 : assessmentDays <= 730 ? 0.5 : 0;

  const interiorDays = daysSince(matterportLink?.space?.syncedAt ?? matterportLink?.linkedAt ?? null);
  const interiorRecencyScore = interiorDays === null ? 0 : interiorDays <= 180 ? 1 : interiorDays <= 365 ? 0.5 : 0;

  const exteriorDays = daysSince(droneCapture?.capturedAt ?? null);
  const exteriorRecencyScore = exteriorDays === null ? 0 : exteriorDays <= 180 ? 1 : exteriorDays <= 365 ? 0.5 : 0;

  const evidenceScore = evidenceCount > 0 ? 1 : 0;

  const dataConfidenceScore = Math.round(
    (categoryCoverage * 40 +
      assessmentScore * 25 +
      interiorRecencyScore * 15 +
      exteriorRecencyScore * 15 +
      evidenceScore * 5) *
      10,
  ) / 10;

  // --- Capital exposure ---------------------------------------------------
  let exp12 = 0;
  let exp24 = 0;
  let exp36 = 0;
  const byCategoryExposure: Record<string, number> = {};

  for (const asset of assets) {
    if (!asset.replacementCost) continue;
    const bucket = assetExposureBucket(asset.conditionScore, asset.installedAt, asset.expectedUsefulLifeYears);
    if (!bucket) continue;
    if (bucket === "12") exp12 += asset.replacementCost;
    else if (bucket === "24") exp24 += asset.replacementCost;
    else exp36 += asset.replacementCost;

    const category = categoryForAsset(asset.assetType, asset.system?.category ?? null) ?? "Other";
    byCategoryExposure[category] = (byCategoryExposure[category] ?? 0) + asset.replacementCost;
  }

  for (const issue of openIssues) {
    if (!issue.estimatedCost) continue;
    const bucket = issueExposureBucket(issue.severity, issue.dueDate);
    if (bucket === "12") exp12 += issue.estimatedCost;
    else if (bucket === "24") exp24 += issue.estimatedCost;
    else exp36 += issue.estimatedCost;
    byCategoryExposure["Issues"] = (byCategoryExposure["Issues"] ?? 0) + issue.estimatedCost;
  }

  void property; // reserved for future org-specific scoring rules

  return {
    healthScore,
    riskScore,
    dataConfidenceScore,
    interiorScore,
    exteriorScore,
    categoryBreakdown,
    capitalExposure12mo: exp12,
    capitalExposure24mo: exp24,
    capitalExposure36mo: exp36,
    capitalExposureByCategory: byCategoryExposure,
  };
}

/** Computes and persists a new (append-only) health snapshot for a property. */
export async function recalculatePropertyHealth(propertyId: string) {
  const result = await computePropertyHealth(propertyId);
  return prisma.propertyHealthSnapshot.create({
    data: {
      propertyId,
      healthScore: result.healthScore,
      riskScore: result.riskScore,
      dataConfidenceScore: result.dataConfidenceScore,
      interiorScore: result.interiorScore,
      exteriorScore: result.exteriorScore,
      categoryBreakdown: result.categoryBreakdown as unknown as Prisma.InputJsonValue,
      capitalExposure12mo: result.capitalExposure12mo,
      capitalExposure24mo: result.capitalExposure24mo,
      capitalExposure36mo: result.capitalExposure36mo,
      capitalExposureByCategory: result.capitalExposureByCategory as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function getLatestHealthSnapshot(propertyId: string) {
  return prisma.propertyHealthSnapshot.findFirst({
    where: { propertyId },
    orderBy: { computedAt: "desc" },
  });
}

/** Efficient "latest snapshot per property" fetch for portfolio-scale dashboards. */
export async function getLatestHealthSnapshots(propertyIds: string[]) {
  if (propertyIds.length === 0) return [];
  return prisma.$queryRaw<
    Array<{
      id: string;
      propertyId: string;
      healthScore: number;
      riskScore: number;
      dataConfidenceScore: number;
      capitalExposure12mo: number;
      capitalExposure24mo: number;
      capitalExposure36mo: number;
      computedAt: Date;
    }>
  >(Prisma.sql`
    SELECT DISTINCT ON ("propertyId") "id", "propertyId", "healthScore", "riskScore",
      "dataConfidenceScore", "capitalExposure12mo", "capitalExposure24mo", "capitalExposure36mo", "computedAt"
    FROM "PropertyHealthSnapshot"
    WHERE "propertyId" IN (${Prisma.join(propertyIds)})
    ORDER BY "propertyId", "computedAt" DESC
  `);
}

/**
 * Data Confidence explanations (spec Phase 2 §9): never hide a low
 * confidence score behind a bare number — say plainly what's missing or
 * stale. Reuses the same recency signals `computePropertyHealth` scores
 * on, just surfaced as readable warnings instead of a percentage.
 */
export async function getDataConfidenceWarnings(propertyId: string): Promise<string[]> {
  const [latestAssessment, matterportLink, droneCapture, assetCounts] = await Promise.all([
    prisma.assessment.findFirst({ where: { propertyId, status: "COMPLETED" }, orderBy: { completedAt: "desc" } }),
    prisma.matterportPropertyLink.findFirst({ where: { propertyId }, orderBy: { linkedAt: "desc" }, include: { space: true } }),
    prisma.droneCapture.findFirst({ where: { propertyId, status: "READY" }, orderBy: { capturedAt: "desc" } }),
    prisma.asset.count({ where: { propertyId, status: "ACTIVE" } }),
  ]);

  const warnings: string[] = [];
  const monthsSince = (d: Date | null | undefined) => (d ? (Date.now() - new Date(d).getTime()) / (30 * 86400000) : null);

  const assessmentAge = monthsSince(latestAssessment?.completedAt);
  if (assessmentAge === null) warnings.push("This property has never had a completed assessment.");
  else if (assessmentAge > 12) warnings.push(`This property's last assessment was ${Math.round(assessmentAge)} months ago.`);

  const interiorAge = monthsSince(matterportLink?.space?.syncedAt ?? matterportLink?.linkedAt);
  if (interiorAge === null) warnings.push("No interior (Matterport) capture is connected for this property.");
  else if (interiorAge > 12) warnings.push(`This property has not had an interior capture refresh in ${Math.round(interiorAge)} months.`);

  const exteriorAge = monthsSince(droneCapture?.capturedAt);
  if (exteriorAge === null) warnings.push("No exterior (drone) capture has been uploaded for this property.");
  else if (exteriorAge > 12) warnings.push(`This property has not had an exterior capture in ${Math.round(exteriorAge)} months.`);

  if (assetCounts === 0) warnings.push("No assets have been recorded for this property yet — health score is not meaningful.");

  return warnings;
}
