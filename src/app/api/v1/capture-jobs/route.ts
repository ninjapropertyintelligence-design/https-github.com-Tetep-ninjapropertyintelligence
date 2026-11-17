import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { listCaptureJobs } from "@/lib/capture-job-service";

// GET /api/v1/capture-jobs — scoped in the service: a vendor sees only their
// own open jobs, everyone else sees the organization's.
export const GET = withApiHandler(async (ctx) => {
  return NextResponse.json({ items: await listCaptureJobs(ctx) });
});

// Creating a capture job is the platform team's: see
// POST /api/v1/admin/capture-jobs, which names the customer organization.
