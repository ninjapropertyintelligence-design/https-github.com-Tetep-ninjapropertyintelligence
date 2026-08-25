import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { requestPropertyDeletion } from "@/lib/retention";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({ reason: z.string().min(5, "A reason is required") });

// POST — schedule this property for deletion after the org's grace window.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  requirePermission(ctx, "canManageProperties");
  const { id } = await params;
  const { reason } = schema.parse(await req.json());
  return NextResponse.json(await requestPropertyDeletion(ctx, id, reason), { status: 201 });
});
