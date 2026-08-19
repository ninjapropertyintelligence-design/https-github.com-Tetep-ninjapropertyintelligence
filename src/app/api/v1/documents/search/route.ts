import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api-utils";
import { propertyScopeWhere } from "@/lib/session-context";
import { searchDocumentChunks } from "@/lib/document-extraction";

// GET /api/v1/documents/search?q=&propertyId=&assetId= — real Postgres
// full-text search over extracted document text (spec §15). Tenant- and
// scope-checked: a chunk belonging to a property outside the caller's
// access never appears, even though DocumentChunk itself only carries
// organizationId directly.
export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const propertyId = url.searchParams.get("propertyId") ?? undefined;
  const assetId = url.searchParams.get("assetId") ?? undefined;

  if (q.length < 2) return NextResponse.json({ results: [] });

  if (propertyId) {
    const property = await prisma.property.findFirst({ where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] } });
    if (!property) return NextResponse.json({ results: [] });
  }

  const hits = await searchDocumentChunks({
    organizationId: ctx.organizationId,
    query: q,
    propertyId,
    assetId,
  });

  // Without a propertyId filter, redact any hit whose document is tied to
  // a property outside this session's scope (org-wide roles pass everything).
  const accessibleProperties = await prisma.property.findMany({ where: propertyScopeWhere(ctx), select: { id: true } });
  const accessibleSet = new Set(accessibleProperties.map((p) => p.id));
  const scoped = propertyId ? hits : hits.filter((h) => !h.propertyId || accessibleSet.has(h.propertyId));

  return NextResponse.json({ results: scoped });
});
