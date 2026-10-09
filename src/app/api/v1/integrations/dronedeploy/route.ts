import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import {
  connectDroneDeploy,
  disconnectDroneDeploy,
  getDroneDeployStatus,
  updateDroneDeploySettings,
} from "@/lib/dronedeploy-import-service";

// GET /api/v1/integrations/dronedeploy — connection state and the import queue.
export const GET = withApiHandler(async (ctx) => {
  return getDroneDeployStatus(ctx);
});

const connectSchema = z.object({ apiKey: z.string().min(1).max(500) });

// POST — connect (or replace the key of) this organization's own DroneDeploy
// account. Unlike Matterport's platform-level env credentials this key belongs
// to the organization making the request, so taking it from the body is the
// point. It is verified before it is stored and never returned.
export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canManageIntegrations");
  const { apiKey } = connectSchema.parse(await req.json());
  return NextResponse.json(await connectDroneDeploy(ctx, apiKey), { status: 201 });
});

const settingsSchema = z.object({
  matchRadiusMeters: z.number().int().min(25).max(5000).optional(),
  importSince: z.coerce.date().optional(),
});

// PATCH — matching radius and the import cut-off date.
export const PATCH = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canManageIntegrations");
  return updateDroneDeploySettings(ctx, settingsSchema.parse(await req.json()));
});

// DELETE — forget the key. Imported captures are kept.
export const DELETE = withApiHandler(async (ctx) => {
  requirePermission(ctx, "canManageIntegrations");
  await disconnectDroneDeploy(ctx);
  return { disconnected: true };
});
