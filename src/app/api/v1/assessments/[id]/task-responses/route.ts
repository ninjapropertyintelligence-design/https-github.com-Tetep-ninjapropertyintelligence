import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { addTaskResponse } from "@/lib/assessment-service";
import { z } from "zod";
import { clientIdSchema } from "@/lib/client-id";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({
  taskId: z.string().min(1),
  label: z.string().max(200).nullish(),
  clientId: clientIdSchema.nullish(),
});

// POST /api/v1/assessments/[id]/task-responses — add a response to a task (another repeat, for a repeatable one).
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const input = schema.parse(await req.json());
  return NextResponse.json(await addTaskResponse(ctx, id, input), { status: 201 });
});
