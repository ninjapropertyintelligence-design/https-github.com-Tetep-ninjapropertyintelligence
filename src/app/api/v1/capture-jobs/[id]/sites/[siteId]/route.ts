import { NextResponse } from "next/server";
import { withApiHandler, ApiError } from "@/lib/api-utils";
import {
  resolveDroneTargetForSite,
  reviewCaptureSite,
  submitCaptureSite,
  submitConditionScores,
} from "@/lib/capture-job-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string; siteId: string }> };

const bodySchema = z.discriminatedUnion("action", [
  // The subcontractor's actual deliverable. Imagery never moves a property's
  // health score — asset condition does — so this is the call that makes the
  // number change.
  z.object({
    action: z.literal("conditions"),
    scores: z
      .array(
        z.object({
          assetId: z.string().min(1),
          score: z.number().min(0).max(100),
          reason: z.string().max(500).nullish(),
          evidenceId: z.string().nullish(),
        }),
      )
      .min(1)
      .max(500),
  }),
  // Resolves where drone files for this site belong, creating the capture
  // and dataset only if there isn't one already in flight.
  z.object({ action: z.literal("drone-target") }),
  z.object({ action: z.literal("submit") }),
  z.object({
    action: z.literal("review"),
    accept: z.boolean(),
    reason: z.string().max(1000).nullish(),
  }),
]);

export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id, siteId } = await params;
  const body = bodySchema.parse(await req.json());

  switch (body.action) {
    case "conditions":
      return NextResponse.json(await submitConditionScores(ctx, id, siteId, body.scores));
    case "drone-target":
      return NextResponse.json(await resolveDroneTargetForSite(ctx, id, siteId));
    case "submit":
      return NextResponse.json(await submitCaptureSite(ctx, id, siteId));
    case "review":
      return NextResponse.json(
        await reviewCaptureSite(ctx, id, siteId, { accept: body.accept, reason: body.reason }),
      );
    default:
      throw new ApiError(400, "Unsupported action");
  }
});
