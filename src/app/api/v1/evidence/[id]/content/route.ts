import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { canAccessProperty } from "@/lib/session-context";
import { getStorageProvider } from "@/lib/storage";

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
const MAX_PROXY_BYTES = 64 * 1024 * 1024;

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;

  const evidence = await prisma.evidence.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, storageKey: true, mimeType: true, sizeBytes: true, propertyId: true },
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

  if (evidence.sizeBytes !== null && Number(evidence.sizeBytes) > MAX_PROXY_BYTES) {
    return NextResponse.redirect(await storage.getDownloadUrl(evidence.storageKey), 302);
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
