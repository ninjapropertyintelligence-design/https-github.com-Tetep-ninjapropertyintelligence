import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { getStorageProvider } from "@/lib/storage";
import { z } from "zod";

const schema = z.object({
  filename: z.string().min(1).max(300),
  contentType: z.string().min(1).max(200),
});

export const POST = withApiHandler(async (ctx, req) => {
  const body = await req.json();
  const input = schema.parse(body);
  const signed = await getStorageProvider().createUploadUrl({
    organizationId: ctx.organizationId,
    filename: input.filename,
    contentType: input.contentType,
  });
  return NextResponse.json(signed);
});
