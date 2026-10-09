import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api-utils";
import { ApiError } from "@/lib/api-error";
import { clientIpFromRequest } from "@/lib/rate-limit";
import { resetPassword } from "@/lib/password-reset-service";

const bodySchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().max(1000),
});

/** POST /api/v1/auth/password/reset — public; the token is the credential. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "This reset link is invalid or has expired. Request a new one.");

  try {
    await resetPassword(parsed.data.token, parsed.data.password, clientIpFromRequest(req));
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.status, err.message);
    console.error("Password reset failed", err);
    return jsonError(500, "Something went wrong. Try again.");
  }

  return NextResponse.json({ data: { ok: true }, error: null, meta: {} });
}
