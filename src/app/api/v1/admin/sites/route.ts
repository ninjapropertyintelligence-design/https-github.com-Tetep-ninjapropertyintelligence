import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { createSiteForOrganization } from "@/lib/platform-capture-service";
import { createPropertySchema } from "@/lib/validation";
import { z } from "zod";

const createSchema = createPropertySchema.extend({
  // The customer the new site belongs to.
  organizationId: z.string().min(1),
});

// POST /api/v1/admin/sites — the platform team adds a site to a customer while
// ordering capture work (platform admin only).
export const POST = withApiHandler(async (ctx, req) => {
  const { organizationId, ...input } = createSchema.parse(await req.json());
  const property = await createSiteForOrganization(ctx, organizationId, input);
  return NextResponse.json(
    { id: property.id, name: property.name, city: property.city, state: property.state },
    { status: 201 },
  );
});
