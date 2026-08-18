import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api-utils";
import { issueScopeWhere, propertyScopeWhere } from "@/lib/session-context";

/**
 * Global search (spec §21) — works without AI. Searches properties, assets,
 * issues, documents and vendors within the caller's tenant + scope, and
 * returns deep-linkable results.
 */
export const GET = withApiHandler(async (ctx, req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const insensitive = { contains: q, mode: "insensitive" as const };

  const [properties, assets, issues, documents, vendors] = await Promise.all([
    prisma.property.findMany({
      where: {
        AND: [
          propertyScopeWhere(ctx),
          { OR: [{ name: insensitive }, { addressLine1: insensitive }, { customerPropertyId: insensitive }] },
        ],
      },
      take: 8,
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.asset.findMany({
      where: {
        organizationId: ctx.organizationId,
        property: propertyScopeWhere(ctx),
        OR: [{ name: insensitive }, { serialNumber: insensitive }, { customerAssetId: insensitive }],
      },
      take: 8,
      select: { id: true, name: true, assetType: true, propertyId: true },
    }),
    prisma.issue.findMany({
      where: { AND: [issueScopeWhere(ctx), { title: insensitive }] },
      take: 8,
      select: { id: true, title: true, severity: true, propertyId: true },
    }),
    prisma.document.findMany({
      where: { organizationId: ctx.organizationId, title: insensitive },
      take: 8,
      select: { id: true, title: true, documentType: true, propertyId: true },
    }),
    prisma.vendor.findMany({
      where: { organizationId: ctx.organizationId, name: insensitive },
      take: 5,
      select: { id: true, name: true, trade: true },
    }),
  ]);

  return NextResponse.json({
    results: [
      ...properties.map((p) => ({ kind: "property", id: p.id, label: p.name, sublabel: `${p.city}, ${p.state}`, href: `/properties/${p.id}` })),
      ...assets.map((a) => ({ kind: "asset", id: a.id, label: a.name, sublabel: a.assetType, href: `/properties/${a.propertyId}/assets/${a.id}` })),
      ...issues.map((i) => ({ kind: "issue", id: i.id, label: i.title, sublabel: i.severity, href: `/issues/${i.id}` })),
      ...documents.map((d) => ({ kind: "document", id: d.id, label: d.title, sublabel: d.documentType, href: `/documents/${d.id}` })),
      ...vendors.map((v) => ({ kind: "vendor", id: v.id, label: v.name, sublabel: v.trade ?? "Vendor", href: `/vendors/${v.id}` })),
    ],
  });
});
