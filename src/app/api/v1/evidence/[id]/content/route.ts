import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { canAccessProperty, captureReviewWhere, contextForCaptureEvidence } from "@/lib/session-context";
import { getStorageProvider } from "@/lib/storage";
import { getOrMakePanoramaStrip, getOrMakeRendition } from "@/lib/media-renditions";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Serves one evidence file's bytes from THIS origin.
 *
 * Why this exists rather than handing the browser the presigned storage URL,
 * which is what everything else does:
 *
 * WebGL refuses to build a texture from a cross-origin image unless the
 * response carries CORS headers — the image is treated as tainted, and the
 * texture upload throws. The object store's presigned URLs carry no such
 * headers, so a 360 panorama loaded straight from storage fails in the
 * viewer while the identical file renders fine in an <img> tag. A redirect
 * does not help: the browser follows it and lands on the same cross-origin
 * response.
 *
 * Serving the bytes from the app's own origin removes the cross-origin
 * question entirely. It also fixes the content type — `writeBytes` presigns
 * a PUT without one, so everything the seed wrote is stored as
 * `application/octet-stream`, which `<img>` survives by sniffing and stricter
 * consumers do not.
 *
 * The cost is that the bytes pass through the function, so there is a size
 * ceiling below. Presigned URLs remain the right answer for downloads and for
 * anything large; this route is for what has to be read by script.
 */

/**
 * Above this, the caller is sent to a presigned URL instead. A serverless
 * function holds the whole body in memory, and a multi-hundred-megabyte point
 * cloud read this way would exhaust it. 64 MB comfortably covers a
 * full-resolution 360 panorama, which is what needs same-origin bytes.
 */
// Vercel refuses a function response over 4.5 MB, so anything bigger goes
// straight to storage. An <img>, a <video> or a download follows the
// redirect fine; a 360 viewer asks for the panorama in strips instead.
const MAX_PROXY_BYTES = 4 * 1024 * 1024;

export const GET = withApiHandler<NextResponse, RouteParams>(async (session, req, { params }) => {
  const { id } = await params;
  // The platform team reviewing a vendor's delivery reads it in that customer's organization.
  const ctx = await contextForCaptureEvidence(session, id);

  const evidence = await prisma.evidence.findFirst({
    // Vendor work not yet accepted reads as absent to everyone but reviewers
    // and the vendor, the same as it does in every list.
    where: { id, organizationId: ctx.organizationId, ...captureReviewWhere(ctx) },
    select: { id: true, type: true, storageKey: true, mimeType: true, sizeBytes: true, propertyId: true, thumbnailKey: true, previewKey: true },
  });
  // 404 rather than 403 for another organization's id: whether a given id
  // exists is itself information.
  if (!evidence) throw new ApiError(404, "Evidence not found");

  // Organization membership is not enough. A regional manager or a vendor is
  // scoped to some of their organization's properties, and evidence inherits
  // the scope of the property it hangs off.
  if (evidence.propertyId && !(await canAccessProperty(ctx, evidence.propertyId))) {
    throw new ApiError(404, "Evidence not found");
  }

  const storage = getStorageProvider();

  // ?strip=k&of=n serves one full-resolution band of a panorama too big to
  // send whole; the 360 viewer stitches the bands back together.
  const search = new URL(req.url).searchParams;
  if (evidence.type === "IMAGE_360" && search.has("strip")) {
    const strip = await getOrMakePanoramaStrip(evidence, Number(search.get("strip")), Number(search.get("of")));
    if (!strip) throw new ApiError(404, "That part of the panorama is not available");
    return new NextResponse(new Uint8Array(strip), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(strip.byteLength),
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // ?size=small|medium serves a resized copy of a photo, made on first
  // request. Anything that cannot be resized falls through to the original.
  const size = search.get("size");
  if ((size === "small" || size === "medium") && (evidence.type === "PHOTO" || evidence.type === "IMAGE_360" || evidence.type === "DRONE_IMAGE")) {
    const rendition = await getOrMakeRendition(evidence, size);
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

  if (evidence.sizeBytes !== null && Number(evidence.sizeBytes) > MAX_PROXY_BYTES) {
    // Local storage signs a path on this app; S3 signs an absolute URL.
    return NextResponse.redirect(new URL(await storage.getDownloadUrl(evidence.storageKey), req.url), 302);
  }

  const bytes = await storage.readBytes(evidence.storageKey);
  if (!bytes) {
    // The row exists and the object does not. Said plainly, because this is a
    // real state — an interrupted upload, or a lifecycle rule that removed the
    // object — and "not found" alone would send someone looking for a bug in
    // permissions.
    throw new ApiError(404, "This evidence file is no longer present in storage");
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      // The recorded type, not the stored one, and never a sniffed guess.
      "Content-Type": evidence.mimeType ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      // Evidence is immutable once registered — a new photo is a new row — so
      // this can be cached hard. Private, because the response is tenant
      // scoped and must never be held by a shared cache.
      "Cache-Control": "private, max-age=3600",
      // The URL is stable and the content type is authoritative, so there is
      // no reason to let a browser sniff its way to a different one.
      "X-Content-Type-Options": "nosniff",
    },
  });
});
