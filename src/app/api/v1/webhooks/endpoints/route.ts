import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { WEBHOOK_EVENT_TYPES, createEndpoint, listEndpoints } from "@/lib/webhooks";

const schema = z.object({
  url: z.string().min(1),
  description: z.string().max(200).optional(),
  eventTypes: z.array(z.string()).optional(),
});

// GET /api/v1/webhooks/endpoints — registered endpoints. Never returns the
// signing secret; it is write-only by design.
export const GET = withApiHandler(async (ctx) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageIntegrations");
  return { items: await listEndpoints(ctx), availableEventTypes: WEBHOOK_EVENT_TYPES };
});

// POST — register an endpoint. The secret is in the response exactly once.
export const POST = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageIntegrations");
  const input = schema.parse(await req.json());
  return NextResponse.json(await createEndpoint(ctx, input), { status: 201 });
});
