import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api-utils";
import { ApiError } from "@/lib/api-error";
import { clientIpFromRequest } from "@/lib/rate-limit";
import { acceptInvitation } from "@/lib/invitation-service";

const bodySchema = z.object({
  token: z.string().min(1).max(200),
  name: z.string().max(1000).nullish(),
  password: z.string().max(1000).nullish(),
});

/** POST /api/v1/invitations/accept — public; the token is the credential. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "This invitation is invalid, has expired, or was already used.");

  try {
    const result = await acceptInvitation(parsed.data.token, parsed.data, clientIpFromRequest(req));
    return NextResponse.json({ data: result, error: null, meta: {} });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.status, err.message);
    console.error("Invitation acceptance failed", err);
    return jsonError(500, "Something went wrong. Try again.");
  }
}
