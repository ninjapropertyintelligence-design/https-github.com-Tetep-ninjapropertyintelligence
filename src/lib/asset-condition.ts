import { prisma } from "@/lib/prisma";
import { IssueSource, Prisma, ValidationStatus } from "@/generated/prisma/client";
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

export interface ConditionChangeParams {
  assetId: string;
  newScore: number;
  changedByUserId: string;
  source?: IssueSource;
  reason?: string;
  evidenceId?: string;
  validationStatus?: ValidationStatus;
}

type Tx = Prisma.TransactionClient;

/**
 * The database half of a condition change: append history and update the
 * asset, inside the caller's transaction. Exported for callers that must
 * commit other rows atomically with it (confirming an AI finding creates its
 * Issue in the same transaction). Anyone calling this MUST then call
 * `afterConditionChange` once the transaction commits — that is where the
 * property snapshot is recalculated and the event emitted.
 */
export async function applyConditionChangeInTx(tx: Tx, params: ConditionChangeParams) {
  const asset = await tx.asset.findUniqueOrThrow({ where: { id: params.assetId } });
  const previousScore = asset.conditionScore;

  const healthScore = computeAssetHealthScore(params.newScore, asset.installedAt, asset.expectedUsefulLifeYears);
  const riskScore = computeAssetRiskScore(healthScore, asset.criticalityScore);

  await tx.assetConditionHistory.create({
    data: {
      assetId: params.assetId,
      previousScore,
      newScore: params.newScore,
      changedByUserId: params.changedByUserId,
      source: params.source ?? IssueSource.MANUAL,
      reason: params.reason,
      evidenceId: params.evidenceId,
    },
  });
  const updatedAsset = await tx.asset.update({
    where: { id: params.assetId },
    data: {
      conditionScore: params.newScore,
      healthScore,
      riskScore,
      validationStatus: params.validationStatus ?? ValidationStatus.HUMAN_OBSERVED,
      updatedBy: params.changedByUserId,
      version: { increment: 1 },
    },
  });

  return { updatedAsset, previousScore, healthScore };
}

/** The post-commit half: recalculate the property and emit the change. */
export async function afterConditionChange(
  change: Awaited<ReturnType<typeof applyConditionChangeInTx>>,
  changedByUserId: string,
) {
  const { updatedAsset: asset, previousScore, healthScore } = change;
  await recalculatePropertyHealth(asset.propertyId);

  await emitEvent({
    organizationId: asset.organizationId,
    propertyId: asset.propertyId,
    type: EVENT_TYPES.ASSET_CONDITION_CHANGED,
    actorUserId: changedByUserId,
    payload: {
      assetId: asset.id,
      assetName: asset.name,
      previousScore,
      newScore: asset.conditionScore,
      healthScore,
    },
  });

  // Crossing into Critical is surfaced via the Event feed and the Facilities
  // dashboard's "Recently Deteriorated Assets" widget (queried directly from
  // AssetConditionHistory), not a push Notification — the spec's notification
  // taxonomy (§35) doesn't include an asset-condition type, only issue/
  // assessment/processing/report events.
}

/**
 * The one place an asset's condition may change (spec §10, §12 flow):
 * 1. Append AssetConditionHistory (never overwrite).
 * 2. Recompute Asset.healthScore / riskScore.
 * 3. Recalculate the owning Property's health snapshot.
 * 4. Emit asset.condition_changed.
 * 5. Return the updated asset so callers (assessment completion, manual asset
 *    edit, drone/AI-suggested condition updates) share one code path instead
 *    of three different partial implementations.
 */
export async function recordAssetConditionChange(params: ConditionChangeParams) {
  const change = await prisma.$transaction((tx) => applyConditionChangeInTx(tx, params));
  await afterConditionChange(change, params.changedByUserId);
  return change.updatedAsset;
}
