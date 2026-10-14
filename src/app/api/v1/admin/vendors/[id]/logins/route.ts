import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createVendorLogin } from "@/lib/platform-capture-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).nullish(),
});

// POST /api/v1/admin/vendors/[id]/logins — gives one of the vendor's people a
// login. Returns the accept link once, so the platform team can hand it over
// directly as well as by email.
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const input = createSchema.parse(await req.json());
  const { invitation, emailSent, acceptUrl } = await createVendorLogin(ctx, id, input);
  return NextResponse.json({ invitationId: invitation.id, email: invitation.email, emailSent, acceptUrl }, { status: 201 });
});
