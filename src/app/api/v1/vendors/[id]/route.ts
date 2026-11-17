import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { deleteContractor, getContractor, updateContractor } from "@/lib/contractor-service";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await getContractor(ctx, id));
});

// PATCH — replace the contractor's details and the stores it serves.
export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await updateContractor(ctx, id, await req.json()));
});

export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  await deleteContractor(ctx, id);
  return NextResponse.json({ deleted: true });
});
