import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { readOverlayContent } from "@/lib/overlay-service";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Serves an overlay's file from this origin. Mapbox loads image sources into
 * WebGL, which refuses cross-origin images without CORS headers — the same
 * reason evidence has its own content route. Overlays are capped well under
 * the size where proxying through the function would hurt.
 */
export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const { bytes, mimeType } = await readOverlayContent(ctx, id);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.byteLength),
      // An overlay's file never changes — a new sheet is a new overlay.
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
