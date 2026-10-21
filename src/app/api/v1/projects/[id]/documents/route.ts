import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { setDocumentProject } from "@/lib/project-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({ documentId: z.string().min(1), attached: z.boolean().default(true) });

// POST — file a property document under this project ({attached: false} takes it out).
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const input = schema.parse(await req.json());
  return NextResponse.json(await setDocumentProject(ctx, id, input.documentId, input.attached));
});
