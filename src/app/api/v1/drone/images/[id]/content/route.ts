import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { contextForDroneImage } from "@/lib/session-context";
import { loadViewableDroneImage } from "@/lib/drone-map-service";
import { getOrMakeKeyRendition } from "@/lib/media-renditions";
import { getStorageProvider } from "@/lib/storage";

type RouteParams = { params: Promise<{ id: string }> };

/** Vercel refuses a function response over 4.5 MB. */
const MAX_PROXY_BYTES = 4 * 1024 * 1024;

/**
 * GET /api/v1/drone/images/[id]/content — one raw drone photo (HD image).
 *
 * ?size=small|medium serves a resized copy, made on first request and kept,
 * so a grid of drone photos does not download every 20 MB original. Without
 * a size, the original: streamed when it fits one response, otherwise a
 * redirect to its signed storage URL, which an <img> or a download follows.
 */
export const GET = withApiHandler<NextResponse, RouteParams>(async (session, req, { params }) => {
  const { id } = await params;
  const ctx = await contextForDroneImage(session, id);
  const image = await loadViewableDroneImage(ctx, id);
  const storage = getStorageProvider();

  const size = new URL(req.url).searchParams.get("size");
  if (size === "small" || size === "medium") {
    const rendition = await getOrMakeKeyRendition(image.storageKey, image.sizeBytes, size);
    if (rendition) {
      return new NextResponse(new Uint8Array(rendition), {
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(rendition.byteLength),
          "Cache-Control": "private, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  }

  if (image.sizeBytes === null || Number(image.sizeBytes) > MAX_PROXY_BYTES) {
    return NextResponse.redirect(new URL(await storage.getDownloadUrl(image.storageKey), req.url), 302);
  }
  const bytes = await storage.readBytes(image.storageKey);
  if (!bytes) throw new ApiError(404, "This drone photo is no longer present in storage");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": image.mimeType ?? "image/jpeg",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
