import { z } from "zod";
import { withApiHandler } from "@/lib/api-utils";
import { findExisting360Checksums, MAX_CHECKSUM_LOOKUP } from "@/lib/image-360-service";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({ checksums: z.array(z.string().max(128)).max(MAX_CHECKSUM_LOOKUP) });

// POST /api/v1/properties/:id/360/existing — which of these SHA-256s this
// property already holds as panoramas. A POST because a card's worth of
// hashes does not fit in a query string; it reads, it does not write.
export const POST = withApiHandler<unknown, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const { checksums } = schema.parse(await req.json());
  return { existing: await findExisting360Checksums(ctx, id, checksums) };
});
