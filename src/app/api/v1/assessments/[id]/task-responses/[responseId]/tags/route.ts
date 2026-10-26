import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { setTaskResponseTags } from "@/lib/assessment-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string; responseId: string }> };

const schema = z.object({ tagValueIds: z.array(z.string().min(1)).max(50) });

// PUT — replace this task response's tags. Photos taken under it afterwards inherit them.
export const PUT = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id, responseId } = await params;
  return NextResponse.json({ tagValueIds: await setTaskResponseTags(ctx, id, responseId, schema.parse(await req.json()).tagValueIds) });
});
