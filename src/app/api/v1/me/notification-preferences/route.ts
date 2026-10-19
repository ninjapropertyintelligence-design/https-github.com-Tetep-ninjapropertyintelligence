import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { getEmailPreferences, setEmailPreferences } from "@/lib/notification-preferences";
import { NotificationType } from "@/generated/prisma/client";

// GET /api/v1/me/notification-preferences — the caller's own email settings.
export const GET = withApiHandler(async (ctx) => {
  return NextResponse.json({ email: await getEmailPreferences(ctx.userId) });
});

const updateSchema = z.object({
  changes: z
    .array(z.object({ type: z.nativeEnum(NotificationType), email: z.boolean() }))
    .min(1)
    .max(Object.values(NotificationType).length),
});

// PATCH /api/v1/me/notification-preferences — always the caller's own; there
// is no way to name another user, so there is nothing to scope.
export const PATCH = withApiHandler(async (ctx, req) => {
  const { changes } = updateSchema.parse(await req.json());
  return NextResponse.json({ email: await setEmailPreferences(ctx.userId, changes) });
});
