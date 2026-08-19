import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { getStorageProvider } from "@/lib/storage";
import { z } from "zod";

const schema = z.object({ filename: z.string().min(1).max(300), contentType: z.string().min(1).max(200) });

// Step 1 of the drone upload flow (spec §6): signed direct-upload URL —
// large drone imagery/outputs never pass through the Next.js server.
export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canPerformCapture");
  const input = schema.parse(await req.json());
  const signed = await getStorageProvider().createUploadUrl({
    organizationId: ctx.organizationId,
    filename: input.filename,
    contentType: input.contentType,
  });
  return NextResponse.json(signed);
});
