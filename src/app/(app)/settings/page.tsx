import { redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ROLE_LABELS } from "@/lib/role-labels";
import { formatCents } from "@/lib/format";

export default async function SettingsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canManageTeam") && !can(ctx, "canManageBilling")) redirect("/dashboard");

  const [org, memberships, subscription, flags, overrides] = await Promise.all([
    prisma.organization.findUnique({ where: { id: ctx.organizationId } }),
    prisma.membership.findMany({ where: { organizationId: ctx.organizationId }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    prisma.organizationSubscription.findUnique({ where: { organizationId: ctx.organizationId }, include: { plan: true } }),
    prisma.featureFlag.findMany(),
    prisma.featureFlagOverride.findMany({ where: { organizationId: ctx.organizationId } }),
  ]);
  const overrideByKey = new Map(overrides.map((o) => [o.flagKey, o.enabled]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Organization Settings</h1>
        <p className="text-sm text-muted">{org?.name}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Team" subtitle={`${memberships.length} members`} />
          <CardBody className="p-0">
            <ul>
              {memberships.map((m) => (
                <li key={m.id} className="flex items-center justify-between border-b border-border px-5 py-2.5 text-sm last:border-0">
                  <div>
                    <p className="font-medium text-foreground">{m.user.name}</p>
                    <p className="text-xs text-muted">{m.user.email}</p>
                  </div>
                  <span className="text-xs text-muted">{ROLE_LABELS[m.role]}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Subscription" />
          <CardBody className="space-y-2 text-sm">
            {subscription ? (
              <>
                <Row label="Plan" value={subscription.plan.name} />
                <Row label="Status" value={subscription.status} />
                <Row label="Price" value={subscription.plan.priceMonthlyCents ? `${formatCents(subscription.plan.priceMonthlyCents)}/mo` : "Custom contract"} />
                <Row label="Included Properties" value={subscription.plan.includedProperties} />
                <Row label="Included Users" value={subscription.plan.includedUsers} />
                <Row label="Included Storage" value={`${subscription.plan.includedStorageGB} GB`} />
              </>
            ) : (
              <p className="text-muted">No subscription configured.</p>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Feature Flags" subtitle="Platform default vs. this organization's override" />
          <CardBody className="p-0">
            <ul>
              {flags.map((f) => {
                const effective = overrideByKey.get(f.key) ?? f.defaultEnabled;
                return (
                  <li key={f.key} className="flex items-center justify-between border-b border-border px-5 py-2.5 text-sm last:border-0">
                    <div>
                      <p className="font-medium text-foreground">{f.key}</p>
                      <p className="text-xs text-muted">{f.description}</p>
                    </div>
                    <span className={`text-xs font-medium ${effective ? "text-[var(--band-good)]" : "text-muted"}`}>{effective ? "Enabled" : "Disabled"}</span>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-1.5 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
