import { NextResponse } from "next/server";
import { withApiHandler, ApiError } from "@/lib/api-utils";
import { getStorageProvider } from "@/lib/storage";
import { MAX_EVIDENCE_BATCH } from "@/lib/evidence-service";
import { z } from "zod";

const schema = z.object({
  files: z
    .array(z.object({ filename: z.string().min(1).max(300), contentType: z.string().min(1).max(200) }))
    .min(1),
});

// Bulk step 1: mint many signed upload URLs in one round trip.
//
// The single-URL endpoint is fine for a phone photo and useless for a drone
// flight, which is several hundred images — at one HTTP call per file the
// round trips dominate the upload. The client PUTs each file directly to
// storage, then registers them all with POST /api/v1/evidence/batch.
export const POST = withApiHandler(async (ctx, req) => {
  const { files } = schema.parse(await req.json());
  if (files.length > MAX_EVIDENCE_BATCH) {
    throw new ApiError(400, `At most ${MAX_EVIDENCE_BATCH} upload URLs per request; this one asked for ${files.length}`);
  }

  const storage = getStorageProvider();
  // Sequential on purpose: presigning is cheap and local, and firing 500
  // concurrent promises buys nothing while making a failure harder to read.
  const urls = [];
  for (const file of files) {
    urls.push(
      await storage.createUploadUrl({
        organizationId: ctx.organizationId,
        filename: file.filename,
        contentType: file.contentType,
      }),
    );
  }
  return NextResponse.json({ urls });
});
