import { NextResponse } from "next/server";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { getStorageProvider } from "@/lib/storage";
import { z } from "zod";

const schema = z.object({
  filename: z.string().min(1).max(300),
  contentType: z.string().min(1).max(200),
});

// Step 1 of adding an overlay: mint a signed URL for the file. Gated on the
// same permission as registering it, so nobody can fill the bucket with
// overlay files they could never attach.
export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canManageProperties");
  const input = schema.parse(await req.json());
  return NextResponse.json(
    await getStorageProvider().createUploadUrl({
      organizationId: ctx.organizationId,
      filename: input.filename,
      contentType: input.contentType,
    }),
  );
});
