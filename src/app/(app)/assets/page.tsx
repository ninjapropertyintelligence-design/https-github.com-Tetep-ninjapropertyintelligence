import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCents } from "@/lib/format";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ criticality?: string; search?: string; assetType?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const params = await searchParams;

  const assets = await prisma.asset.findMany({
    where: {
      organizationId: ctx.organizationId,
      property: propertyScopeWhere(ctx),
      status: "ACTIVE",
      ...(params.criticality ? { criticalityScore: { gte: Number(params.criticality) } } : {}),
      ...(params.assetType ? { assetType: { contains: params.assetType, mode: "insensitive" } } : {}),
      ...(params.search
        ? { OR: [{ name: { contains: params.search, mode: "insensitive" } }, { serialNumber: { contains: params.search, mode: "insensitive" } }] }
        : {}),
    },
    orderBy: { healthScore: "asc" },
    include: { property: { select: { id: true, name: true } } },
    take: 200,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Assets</h1>
        <p className="text-sm text-muted">{assets.length} assets in scope, worst condition first</p>
      </div>

      <form className="flex flex-wrap gap-2" action="/assets">
        <input name="search" defaultValue={params.search} placeholder="Search name or serial number..." className="w-64 rounded-lg border border-border px-3 py-1.5 text-sm outline-none focus:border-brand" />
        <select name="criticality" defaultValue={params.criticality ?? ""} className="rounded-lg border border-border px-3 py-1.5 text-sm">
          <option value="">Any criticality</option>
          <option value="4">4+ (Major/Business-Critical)</option>
          <option value="5">5 (Business-Critical only)</option>
        </select>
        <button type="submit" className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">
          Filter
        </button>
      </form>

      {assets.length === 0 ? (
        <EmptyState title="No assets found" description="Add assets from a property's Assets tab, or adjust your filters." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Asset</th>
                  <th className="px-3 py-2.5 font-medium">Property</th>
                  <th className="px-3 py-2.5 font-medium">Criticality</th>
                  <th className="px-3 py-2.5 font-medium">Condition</th>
                  <th className="px-5 py-2.5 text-right font-medium">Replacement Cost</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0 hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <Link href={`/assets/${a.id}`} className="font-medium text-foreground hover:text-brand">
                        {a.name}
                      </Link>
                      <p className="text-xs text-muted">{a.assetType}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/properties/${a.property.id}`} className="text-muted hover:text-brand">
                        {a.property.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{a.criticalityScore}</td>
                    <td className="px-3 py-3 tabular-nums">{a.conditionScore ?? "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{a.replacementCost ? formatCents(a.replacementCost) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
