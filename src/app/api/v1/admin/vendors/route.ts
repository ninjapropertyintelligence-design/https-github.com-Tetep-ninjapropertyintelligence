import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createVendorForOrganization } from "@/lib/platform-capture-service";
import { z } from "zod";

const createSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1).max(200),
  trade: z.string().max(100).nullish(),
  contactEmail: z.string().email().nullish().or(z.literal("")),
  contactPhone: z.string().max(50).nullish(),
});

// POST /api/v1/admin/vendors — the platform team adds a vendor company to a
// customer organization (platform admin only).
export const POST = withApiHandler(async (ctx, req) => {
  const { organizationId, ...input } = createSchema.parse(await req.json());
  const vendor = await createVendorForOrganization(ctx, organizationId, input);
  return NextResponse.json(vendor, { status: 201 });
});
