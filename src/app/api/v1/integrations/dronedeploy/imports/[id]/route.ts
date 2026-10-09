import { z } from "zod";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import {
  assignDroneDeployImport,
  ignoreDroneDeployImport,
  retryDroneDeployImport,
} from "@/lib/dronedeploy-import-service";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), propertyId: z.string().min(1) }),
  z.object({ action: z.literal("ignore") }),
  z.object({ action: z.literal("retry") }),
]);

// POST /api/v1/integrations/dronedeploy/imports/:id — a person resolves a map
// the importer could not: file it to a property, ignore it, or retry it.
export const POST = withApiHandler<unknown, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canManageDroneJobs");
  const { id } = await params;
  const body = schema.parse(await req.json());
  if (body.action === "assign") return assignDroneDeployImport(ctx, id, body.propertyId);
  if (body.action === "ignore") return ignoreDroneDeployImport(ctx, id);
  return retryDroneDeployImport(ctx, id);
});
