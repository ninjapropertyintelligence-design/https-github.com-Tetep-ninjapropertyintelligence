import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { createInvitation, listPendingInvitations } from "@/lib/invitation-service";
import { AccessScopeType, Role } from "@/generated/prisma/client";

// GET /api/v1/invitations — pending invitations for the active organization.
export const GET = withApiHandler(async (ctx) => {
  return NextResponse.json({ items: await listPendingInvitations(ctx) });
});

const createSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).nullish(),
  role: z.nativeEnum(Role),
  vendorId: z.string().nullish(),
  grants: z
    .array(z.object({ scopeType: z.nativeEnum(AccessScopeType), id: z.string().min(1) }))
    .max(500)
    .default([]),
});

// POST /api/v1/invitations — invite someone; the service decides who may.
export const POST = withApiHandler(async (ctx, req) => {
  const input = createSchema.parse(await req.json());
  const result = await createInvitation(ctx, input);
  return NextResponse.json(result, { status: 201 });
});
