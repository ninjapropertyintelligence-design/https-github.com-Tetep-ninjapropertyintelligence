import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { removeMember, updateMembership } from "@/lib/member-service";
import { AccessScopeType, Role } from "@/generated/prisma/client";

type RouteParams = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  role: z.nativeEnum(Role),
  vendorId: z.string().nullish(),
  grants: z
    .array(z.object({ scopeType: z.nativeEnum(AccessScopeType), id: z.string().min(1) }))
    .max(500)
    .default([]),
});

// PATCH /api/v1/members/:id — change a member's role, vendor company and access.
export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const input = updateSchema.parse(await req.json());
  return NextResponse.json(await updateMembership(ctx, id, input));
});

// DELETE /api/v1/members/:id — remove someone from this organization.
export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  await removeMember(ctx, id);
  return NextResponse.json({ ok: true });
});
