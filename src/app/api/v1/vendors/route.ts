import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission, withApiHandler } from "@/lib/api-utils";
import { z } from "zod";

export const GET = withApiHandler(async (ctx) => {
  const vendors = await prisma.vendor.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ items: vendors });
});

const createVendorSchema = z.object({
  name: z.string().min(1).max(200),
  trade: z.string().max(100).nullish(),
  contactEmail: z.string().email().nullish(),
  contactPhone: z.string().max(50).nullish(),
});

export const POST = withApiHandler(async (ctx, req) => {
  requirePermission(ctx, "canManageVendors");
  const body = await req.json();
  const input = createVendorSchema.parse(body);
  const vendor = await prisma.vendor.create({
    data: { organizationId: ctx.organizationId, ...input },
  });
  return NextResponse.json(vendor, { status: 201 });
});
