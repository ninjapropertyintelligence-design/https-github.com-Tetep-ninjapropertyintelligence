import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { readExpiryTag } from "@/lib/ai/expiry-reader";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({ evidenceId: z.string().min(1) });

// POST — read the expiry date off a photo of this asset's tag, and start counting it down.
// The photo is registered first (POST /api/v1/evidence); this reads it.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const { evidenceId } = schema.parse(await req.json());
  const result = await readExpiryTag(ctx, { assetId: id, evidenceId });
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
});
