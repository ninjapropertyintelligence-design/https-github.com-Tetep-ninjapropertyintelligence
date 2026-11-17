import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere, can } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { CONTRACTOR_TRADES, getContractor } from "@/lib/contractor-service";
import { ContractorForm } from "@/components/contractor/ContractorForm";
import { ContractorContact } from "@/components/contractor/CallLinks";
import { DeleteContractorButton } from "@/components/contractor/DeleteContractorButton";

export default async function ContractorPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canManageVendors") && !can(ctx, "canViewPortfolio")) redirect("/dashboard");
  const { id } = await params;

  let contractor;
  try {
    contractor = await getContractor(ctx, id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const canManage = can(ctx, "canManageVendors");
  const properties = canManage
    ? await prisma.property.findMany({ where: propertyScopeWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 })
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/contractors" className="text-xs text-muted hover:text-brand">
            ← Contractors
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-foreground">{contractor.name}</h1>
          <p className="text-sm text-muted">{contractor.trade ?? "No trade set"}</p>
        </div>
        {canManage ? <DeleteContractorButton contractorId={contractor.id} name={contractor.name} /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Contact" />
          <CardBody>
            <ContractorContact c={contractor} />
            {contractor.notes ? <p className="mt-3 whitespace-pre-line text-sm text-muted">{contractor.notes}</p> : null}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Equipment they service" subtitle={`${contractor.serviceAssets.length} assigned`} />
          <CardBody className="p-0">
            {contractor.serviceAssets.length === 0 ? (
              <p className="p-5 text-sm text-muted">No equipment assigned. Choose a contractor on an asset&apos;s page.</p>
            ) : (
              <ul>
                {contractor.serviceAssets.map((a) => (
                  <li key={a.id} className="flex items-center justify-between border-b border-border px-5 py-2.5 text-sm last:border-0">
                    <Link href={`/assets/${a.id}`} className="font-medium text-foreground hover:text-brand">
                      {a.name}
                    </Link>
                    <span className="text-xs text-muted">{a.property.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {canManage ? (
        <Card>
          <CardHeader title="Edit details and stores" />
          <CardBody>
            <ContractorForm
              contractorId={contractor.id}
              trades={CONTRACTOR_TRADES}
              properties={properties}
              initial={{
                name: contractor.name,
                trade: contractor.trade ?? "",
                contactName: contractor.contactName ?? "",
                contactEmail: contractor.contactEmail ?? "",
                contactPhone: contractor.contactPhone ?? "",
                emergencyPhone: contractor.emergencyPhone ?? "",
                notes: contractor.notes ?? "",
                servesAllProperties: contractor.servesAllProperties,
                propertyIds: contractor.properties.map((p) => p.propertyId),
              }}
            />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
