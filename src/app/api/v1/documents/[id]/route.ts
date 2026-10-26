import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { setDocumentFlags } from "@/lib/embed-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({
  showInInfoTab: z.boolean().optional(),
  availableInCapture: z.boolean().optional(),
});

// PATCH /api/v1/documents/[id] — where this document is surfaced.
export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await setDocumentFlags(ctx, id, schema.parse(await req.json())));
});
