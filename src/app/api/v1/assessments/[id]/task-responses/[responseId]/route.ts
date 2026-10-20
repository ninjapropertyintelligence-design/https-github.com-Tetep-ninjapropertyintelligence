import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { deleteTaskResponse, setTaskResponseComplete } from "@/lib/assessment-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string; responseId: string }> };

const patchSchema = z.object({ isComplete: z.boolean() });

// PATCH — mark a completable task's response complete, or not.
export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id, responseId } = await params;
  const input = patchSchema.parse(await req.json());
  return NextResponse.json(await setTaskResponseComplete(ctx, id, responseId, input.isComplete));
});

// DELETE — remove one repeat of a repeatable task, with its answers.
export const DELETE = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id, responseId } = await params;
  await deleteTaskResponse(ctx, id, responseId);
  return NextResponse.json({ deleted: true });
});
