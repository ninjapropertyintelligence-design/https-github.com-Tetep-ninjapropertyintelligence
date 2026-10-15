import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { linkVendorMatterportSpace } from "@/lib/vendor-connection-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string; siteId: string }> };

const bodySchema = z.object({ spaceId: z.string().min(1).max(200) });

// POST …/matterport — put one of the vendor's own Matterport scans on the site.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id, siteId } = await params;
  const { spaceId } = bodySchema.parse(await req.json());
  return NextResponse.json(await linkVendorMatterportSpace(ctx, id, siteId, spaceId), { status: 201 });
});
