import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requirePermission, withApiHandler } from "@/lib/api-utils";
import { deleteDefectRule, listEffectiveDefectRules, upsertDefectRule } from "@/lib/defect-rules";
import { writeAuditLog } from "@/lib/audit";
import type { ScoringCategory } from "@/lib/scoring-categories";

const ruleSchema = z.object({
  defectClass: z.string().min(2).max(64),
  category: z.string().min(1),
  defaultSeverity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  conditionHit: z.number().int(),
  repairCostCents: z.number().int(),
});

// GET /api/v1/defect-rules — this organization's effective rulebook: platform
// defaults with its overrides applied. Costs are financial exposure, so the
// same permission that sees capital exposure sees these.
export const GET = withApiHandler(async (ctx) => {
  requirePermission(ctx, "canViewFinancialExposure");
  return NextResponse.json(await listEffectiveDefectRules(ctx.organizationId));
});

// PUT /api/v1/defect-rules — set one class's rule for this organization.
// Changes what every FUTURE confirmation does; confirmed findings keep the
// numbers they were confirmed with.
export const PUT = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canManageProperties");
  const input = ruleSchema.parse(await req.json());
  const rule = await upsertDefectRule(ctx.organizationId, ctx.userId, {
    ...input,
    category: input.category as ScoringCategory,
  });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "defect_rule.updated",
    entityType: "DefectRule",
    entityId: rule.id,
    metadata: input,
  });
  return NextResponse.json(rule);
});

// DELETE /api/v1/defect-rules?defectClass=... — drop this organization's
// override, falling back to the platform default if there is one.
export const DELETE = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canManageProperties");
  const defectClass = new URL(req.url).searchParams.get("defectClass");
  if (!defectClass) throw new ApiError(400, "defectClass is required");
  if (!(await deleteDefectRule(ctx.organizationId, defectClass))) {
    throw new ApiError(404, "This organization has no rule of its own for that class");
  }
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "defect_rule.deleted",
    entityType: "DefectRule",
    metadata: { defectClass },
  });
  return NextResponse.json({ ok: true });
});
