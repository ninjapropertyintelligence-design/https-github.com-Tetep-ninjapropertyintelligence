import { NextResponse, after } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api-utils";
import { ApiError } from "@/lib/api-error";
import { clientIpFromRequest } from "@/lib/rate-limit";
import { assertResetRequestAllowed, requestPasswordReset } from "@/lib/password-reset-service";

const bodySchema = z.object({ email: z.string().trim().email().max(320) });

/**
 * POST /api/v1/auth/password/forgot — public; nobody is signed in to forget
 * a password. Answers the same thing whether or not the address has an
 * account, and does the lookup and the sending after the response is gone.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Enter a valid email address.");

  const ip = clientIpFromRequest(req);
  try {
    assertResetRequestAllowed(parsed.data.email, ip);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.status, err.message);
    throw err;
  }

  after(async () => {
    try {
      await requestPasswordReset(parsed.data.email, ip);
    } catch (err) {
      console.error("Password reset request failed", err);
    }
  });

  return NextResponse.json({
    data: { message: "If that address has an account, a reset link is on its way." },
    error: null,
    meta: {},
  });
}
