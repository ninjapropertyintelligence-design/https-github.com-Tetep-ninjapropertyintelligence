import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/v1/properties/[id]/history — canonical event feed for the property's
// History tab. Derived entirely from Event rows; nothing here is hand-maintained.
export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const property = await prisma.property.findFirst({
    where: { AND: [{ id }, propertyScopeWhere(ctx)] },
    select: { id: true },
  });
  if (!property) throw new ApiError(404, "Property not found");

  const url = new URL(req.url);
  const take = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));

  const events = await prisma.event.findMany({
    where: { propertyId: id },
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ events });
});
