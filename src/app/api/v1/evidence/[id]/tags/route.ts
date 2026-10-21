import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { setEvidenceTags } from "@/lib/tag-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({ tagValueIds: z.array(z.string().min(1)).max(50) });

// PUT — replace this photo's tags.
export const PUT = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json({ tagValueIds: await setEvidenceTags(ctx, id, schema.parse(await req.json()).tagValueIds) });
});
