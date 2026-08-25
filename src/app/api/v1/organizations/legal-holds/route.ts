import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { listLegalHolds, placeLegalHold } from "@/lib/retention";

const schema = z.object({
  scopeType: z.enum(["ORGANIZATION", "PROPERTY"]),
  propertyId: z.string().min(1).nullable().optional(),
  reason: z.string().min(5, "A reason is required for a legal hold"),
});

export const GET = withApiHandler(async (ctx) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canViewAuditLogs");
  return { items: await listLegalHolds(ctx) };
});

export const POST = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageBilling");
  const hold = await placeLegalHold(ctx, schema.parse(await req.json()));
  return NextResponse.json(hold, { status: 201 });
});
