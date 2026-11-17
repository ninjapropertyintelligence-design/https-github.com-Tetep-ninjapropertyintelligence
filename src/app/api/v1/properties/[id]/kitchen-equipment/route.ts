import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { addKitchenEquipment } from "@/lib/kitchen-service";

type RouteParams = { params: Promise<{ id: string }> };

// POST — add the restaurant kitchen equipment catalog to this property as
// assets, one area per kitchen zone. Running it again only adds what is missing.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const result = await addKitchenEquipment(ctx, id);
  return NextResponse.json(result, { status: result.created > 0 ? 201 : 200 });
});
