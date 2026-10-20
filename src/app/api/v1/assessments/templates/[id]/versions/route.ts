import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { saveAsNewVersion } from "@/lib/template-service";

type RouteParams = { params: Promise<{ id: string }> };

// POST — save a changed definition as a new template, retiring this one.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await saveAsNewVersion(ctx, id, await req.json()), { status: 201 });
});
