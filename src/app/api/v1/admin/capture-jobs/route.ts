import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createCaptureJobForOrganization, listAllCaptureJobs } from "@/lib/platform-capture-service";
import { z } from "zod";

const DELIVERABLES = ["DRONE", "MATTERPORT", "IMAGE_360", "PHOTOS", "CONDITION_SCORES"] as const;

const createSchema = z.object({
  // The customer whose sites the vendor is being sent to.
  organizationId: z.string().min(1),
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
  // Send to the vendor now, rather than saving a draft. Issuing is what gives
  // the vendor access to the sites.
  issue: z.boolean().optional(),
});

// GET /api/v1/admin/capture-jobs — every customer's capture jobs (platform admin only).
export const GET = withApiHandler(async (ctx) => {
  return NextResponse.json({ items: await listAllCaptureJobs(ctx) });
});

// POST /api/v1/admin/capture-jobs — the platform team orders capture work on a
// customer's sites.
export const POST = withApiHandler(async (ctx, req) => {
  const { organizationId, issue, ...input } = createSchema.parse(await req.json());
  const job = await createCaptureJobForOrganization(ctx, organizationId, input, { issue: issue ?? false });
  return NextResponse.json({ id: job.id }, { status: 201 });
});
