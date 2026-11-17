import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere, can } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { CONTRACTOR_TRADES, listContractors } from "@/lib/contractor-service";
import { ContractorForm } from "@/components/contractor/ContractorForm";
import { ContractorContact } from "@/components/contractor/CallLinks";

export default async function ContractorsPage({ searchParams }: { searchParams: Promise<{ trade?: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canManageVendors") && !can(ctx, "canViewPortfolio")) redirect("/dashboard");
  const { trade } = await searchParams;

  const [contractors, properties] = await Promise.all([
    listContractors(ctx, { trade }),
    prisma.property.findMany({ where: propertyScopeWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);
  const canManage = can(ctx, "canManageVendors");

  // Grouped by trade, so "who fixes the walk-in" is one glance, not a search.
  const byTrade = new Map<string, typeof contractors>();
  for (const c of contractors) byTrade.set(c.trade ?? "Other", [...(byTrade.get(c.trade ?? "Other") ?? []), c]);
  const usedTrades = [...new Set((await prisma.vendor.findMany({ where: { organizationId: ctx.organizationId }, select: { trade: true } })).map((v) => v.trade).filter((t): t is string => !!t))].sort();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Contractors</h1>
        <p className="text-sm text-muted">Who to call when something breaks, with an after-hours number, and the stores each one serves.</p>
      </div>

      {usedTrades.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Link href="/contractors" className={`rounded-full border px-3 py-1 ${!trade ? "border-brand bg-brand text-brand-foreground" : "border-border text-muted hover:text-foreground"}`}>
            All trades
          </Link>
          {usedTrades.map((t) => (
            <Link key={t} href={`/contractors?trade=${encodeURIComponent(t)}`} className={`rounded-full border px-3 py-1 ${trade === t ? "border-brand bg-brand text-brand-foreground" : "border-border text-muted hover:text-foreground"}`}>
              {t}
            </Link>
          ))}
        </div>
      ) : null}

      {contractors.length === 0 ? (
        <EmptyState title="No contractors yet" description="Add the refrigeration tech, the hood cleaner, the plumber — whoever you call when something breaks." />
      ) : (
        [...byTrade.entries()].map(([group, items]) => (
          <Card key={group}>
            <CardHeader title={group} subtitle={`${items.length} contractor${items.length === 1 ? "" : "s"}`} />
            <CardBody className="p-0">
              <ul>
                {items.map((c) => (
                  <li key={c.id} className="grid gap-3 border-b border-border px-5 py-4 last:border-0 md:grid-cols-3">
                    <div>
                      <Link href={`/contractors/${c.id}`} className="font-medium text-foreground hover:text-brand">
                        {c.name}
                      </Link>
                      <p className="text-xs text-muted">
                        {c.servesAllProperties
                          ? "Serves every store"
                          : c.properties.length === 0
                            ? "No stores assigned"
                            : `${c.properties.length} store${c.properties.length === 1 ? "" : "s"}`}
                        {c._count.serviceAssets > 0 ? ` · ${c._count.serviceAssets} equipment` : ""}
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <ContractorContact c={c} />
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))
      )}

      {canManage ? (
        <Card>
          <CardHeader title="Add a contractor" />
          <CardBody>
            <ContractorForm trades={CONTRACTOR_TRADES} properties={properties} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
