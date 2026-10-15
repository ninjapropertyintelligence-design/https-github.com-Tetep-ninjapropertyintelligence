import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { contextForDroneOutput } from "@/lib/session-context";
import { loadViewableOutput } from "@/lib/drone-map-service";
import { isBrowserImage } from "@/lib/drone-display";
import { getStorageProvider } from "@/lib/storage";

type RouteParams = { params: Promise<{ id: string }> };

/** A map preview is a few MB; anything this large belongs in tiles, not here. */
const MAX_PROXY_BYTES = 64 * 1024 * 1024;

/**
 * GET /api/v1/drone/outputs/[id]/content — a drone map image from THIS origin.
 *
 * The drone map viewer draws the map with WebGL, which refuses a cross-origin
 * image without CORS headers, and the object store's signed URLs carry none —
 * the same reason as /api/v1/evidence/[id]/content. Only viewable images are
 * served; full-resolution files are downloaded through their signed URL.
 */
export const GET = withApiHandler<NextResponse, RouteParams>(async (session, req, { params }) => {
  const { id } = await params;
  const ctx = await contextForDroneOutput(session, id);
  const output = await loadViewableOutput(ctx, id);
  if (!isBrowserImage(output.storageKey)) throw new ApiError(400, "Only map images are served here");
  if (output.sizeBytes !== null && Number(output.sizeBytes) > MAX_PROXY_BYTES) {
    return NextResponse.redirect(await getStorageProvider().getDownloadUrl(output.storageKey), 302);
  }
  const bytes = await getStorageProvider().readBytes(output.storageKey);
  if (!bytes) throw new ApiError(404, "This map file is no longer present in storage");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": output.mimeType ?? (/\.png$/i.test(output.storageKey) ? "image/png" : "image/jpeg"),
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
