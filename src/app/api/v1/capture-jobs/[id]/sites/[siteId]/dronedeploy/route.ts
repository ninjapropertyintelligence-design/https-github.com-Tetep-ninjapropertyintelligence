import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import {
  importVendorDroneDeployMap,
  listVendorDroneDeployImports,
  listVendorDroneDeployMaps,
  refreshVendorDroneDeployImports,
} from "@/lib/vendor-connection-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string; siteId: string }> };

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("import"), planId: z.string().min(1).max(200) }),
  z.object({ action: z.literal("refresh") }),
]);

// GET …/dronedeploy?view=maps — the vendor's DroneDeploy maps, nearest first.
// GET …/dronedeploy — what has been brought in for this site so far.
export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id, siteId } = await params;
  if (new URL(req.url).searchParams.get("view") === "maps") {
    return NextResponse.json({ items: await listVendorDroneDeployMaps(ctx, id, siteId) });
  }
  return NextResponse.json({ items: await listVendorDroneDeployImports(ctx, id, siteId) });
});

// POST …/dronedeploy — import one map onto the site, or check on imports in progress.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id, siteId } = await params;
  const body = bodySchema.parse(await req.json());
  const items =
    body.action === "import"
      ? await importVendorDroneDeployMap(ctx, id, siteId, body.planId)
      : await refreshVendorDroneDeployImports(ctx, id, siteId);
  return NextResponse.json({ items });
});
