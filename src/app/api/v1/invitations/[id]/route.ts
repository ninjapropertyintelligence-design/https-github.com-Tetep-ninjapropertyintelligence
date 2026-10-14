import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { resendInvitation, revokeInvitation } from "@/lib/invitation-service";

type RouteParams = { params: Promise<{ id: string }> };

const bodySchema = z.object({ action: z.literal("resend") });

// POST /api/v1/invitations/:id { action: "resend" } — a fresh link, a fresh week.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  bodySchema.parse(await req.json());
  return NextResponse.json(await resendInvitation(ctx, id));
});

// DELETE /api/v1/invitations/:id — cancel; the link stops working at once.
export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  await revokeInvitation(ctx, id);
  return NextResponse.json({ ok: true });
});
