import { NextResponse } from "next/server";
import { withApiHandler, requirePermission } from "@/lib/api-utils";
import { createCaptureJob, listCaptureJobs } from "@/lib/capture-job-service";
import { z } from "zod";

const DELIVERABLES = ["DRONE", "MATTERPORT", "IMAGE_360", "PHOTOS", "CONDITION_SCORES"] as const;

const createSchema = z.object({
  title: z.string().min(1).max(200),
  vendorId: z.string().nullish(),
  instructions: z.string().max(4000).nullish(),
  dueDate: z.coerce.date().nullish(),
  propertyIds: z.array(z.string()).min(1).max(1000),
  deliverables: z.array(z.enum(DELIVERABLES)).min(1),
  // The route, applied to every site on the job. Order is the walking order.
  shots: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        kind: z.enum(["PHOTO", "IMAGE_360"]).optional(),
        required: z.boolean().optional(),
        notes: z.string().max(500).optional(),
      }),
    )
    .max(50)
    .optional(),
});

// GET /api/v1/capture-jobs — scoped in the service: a vendor sees only their
// own open jobs, everyone else sees the organization's.
export const GET = withApiHandler(async (ctx) => {
  return NextResponse.json({ items: await listCaptureJobs(ctx) });
});

// POST /api/v1/capture-jobs — creates a DRAFT. Issuing is a separate step
// because issuing is what grants the vendor access to the sites.
export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canManageProperties");
  const input = createSchema.parse(await req.json());
  const job = await createCaptureJob(ctx, input);
  return NextResponse.json(job, { status: 201 });
});
