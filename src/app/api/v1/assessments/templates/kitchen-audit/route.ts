import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { installKitchenAuditTemplate } from "@/lib/kitchen-service";

// POST — add the "Restaurant Kitchen Audit" template to this organization,
// or return the active one already there.
export const POST = withApiHandler(async (ctx) => {
  const { template, created } = await installKitchenAuditTemplate(ctx);
  return NextResponse.json({ id: template.id, name: template.name, created }, { status: created ? 201 : 200 });
});
