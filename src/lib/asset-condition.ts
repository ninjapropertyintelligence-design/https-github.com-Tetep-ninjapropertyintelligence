import { prisma } from "@/lib/prisma";
import { IssueSource, ValidationStatus } from "@/generated/prisma/client";
import { recalculatePropertyHealth } from "@/lib/scoring";
import { emitEvent, EVENT_TYPES } from "@/lib/events";

function computeAssetHealthScore(
  conditionScore: number,
  installedAt: Date | null,
  expectedUsefulLifeYears: number | null,
): number {
  if (!installedAt || !expectedUsefulLifeYears) return Math.round(conditionScore * 10) / 10;
  const ageYears = (Date.now() - new Date(installedAt).getTime()) / (365.25 * 86400000);
  const remainingLifeFactor = Math.min(1, Math.max(0, 1 - ageYears / expectedUsefulLifeYears));
  const blended = 0.8 * conditionScore + 0.2 * remainingLifeFactor * 100;
  return Math.round(blended * 10) / 10;
}

function computeAssetRiskScore(healthScore: number, criticalityScore: number): number {
  const criticalityBoost = (criticalityScore - 3) * 8;
  return Math.min(100, Math.max(0, Math.round((100 - healthScore + criticalityBoost) * 10) / 10));
}

/**
 * The one place an asset's condition may change (spec §10, §12 flow):
 * 1. Append AssetConditionHistory (never overwrite).
 * 2. Recompute Asset.healthScore / riskScore.
 * 3. Recalculate the owning Property's health snapshot.
 * 4. Emit asset.condition_changed + notify stakeholders if it crossed into Critical.
 * 5. Return the updated asset so callers (assessment completion, manual asset
 *    edit, drone/AI-suggested condition updates) share one code path instead
 *    of three different partial implementations.
 */
export async function recordAssetConditionChange(params: {
  assetId: string;
  newScore: number;
  changedByUserId: string;
  source?: IssueSource;
  reason?: string;
  evidenceId?: string;
  validationStatus?: ValidationStatus;
}) {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: params.assetId } });
  const previousScore = asset.conditionScore;

  const healthScore = computeAssetHealthScore(
    params.newScore,
    asset.installedAt,
    asset.expectedUsefulLifeYears,
  );
  const riskScore = computeAssetRiskScore(healthScore, asset.criticalityScore);

  const [, updatedAsset] = await prisma.$transaction([
    prisma.assetConditionHistory.create({
      data: {
        assetId: params.assetId,
        previousScore,
        newScore: params.newScore,
        changedByUserId: params.changedByUserId,
        source: params.source ?? IssueSource.MANUAL,
        reason: params.reason,
        evidenceId: params.evidenceId,
      },
    }),
    prisma.asset.update({
      where: { id: params.assetId },
      data: {
        conditionScore: params.newScore,
        healthScore,
        riskScore,
        validationStatus: params.validationStatus ?? ValidationStatus.HUMAN_OBSERVED,
        updatedBy: params.changedByUserId,
        version: { increment: 1 },
      },
    }),
  ]);

  await recalculatePropertyHealth(asset.propertyId);

  await emitEvent({
    organizationId: asset.organizationId,
    propertyId: asset.propertyId,
    type: EVENT_TYPES.ASSET_CONDITION_CHANGED,
    actorUserId: params.changedByUserId,
    payload: {
      assetId: asset.id,
      assetName: asset.name,
      previousScore,
      newScore: params.newScore,
      healthScore,
    },
  });

  // Crossing into Critical is surfaced via the Event feed and the Facilities
  // dashboard's "Recently Deteriorated Assets" widget (queried directly from
  // AssetConditionHistory), not a push Notification — the spec's notification
  // taxonomy (§35) doesn't include an asset-condition type, only issue/
  // assessment/processing/report events.

  return updatedAsset;
}
