import { NextResponse } from "next/server";
import { withApiHandler, ApiError } from "@/lib/api-utils";
import { getCaptureJob, issueCaptureJob, outstandingDeliverables } from "@/lib/capture-job-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const patchSchema = z.object({ action: z.literal("issue") });

// GET /api/v1/capture-jobs/[id] — the job, its sites, and what each site still
// owes. The outstanding list is computed from the data rather than stored, so
// it cannot drift from what has actually been delivered.
export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const job = await getCaptureJob(ctx, id);
  const outstanding = await Promise.all(
    job.sites.map(async (site) => ({ siteId: site.id, ...(await outstandingDeliverables(site.id)) })),
  );
  return NextResponse.json({ job, outstanding });
});

export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const { action } = patchSchema.parse(await req.json());
  if (action !== "issue") throw new ApiError(400, "Unsupported action");
  return NextResponse.json(await issueCaptureJob(ctx, id));
});
