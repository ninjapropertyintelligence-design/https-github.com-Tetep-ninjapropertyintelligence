import { redirect } from "next/navigation";
import { can, getSessionContext } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { propertyScopeWhere } from "@/lib/tenant-scope";
import { getDroneDeployStatus } from "@/lib/dronedeploy-import-service";
import { DroneDeployManager } from "@/components/dronedeploy/DroneDeployManager";

/** DroneDeploy auto-import: connect the account, watch maps arrive, file the ones GPS could not. */
export default async function DroneDeployPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.organizationId || !can(ctx, "canManageIntegrations")) redirect("/dashboard");

  const [status, properties] = await Promise.all([
    getDroneDeployStatus(ctx),
    prisma.property.findMany({
      where: propertyScopeWhere(ctx),
      select: { id: true, name: true, city: true, state: true },
      orderBy: { name: "asc" },
      take: 1000,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">DroneDeploy</h1>
        <p className="text-sm text-muted">
          Finished DroneDeploy maps are pulled in automatically and filed to the property they were flown over.
        </p>
      </div>
      <div className="max-w-5xl">
        <DroneDeployManager
          status={JSON.parse(JSON.stringify(status))}
          properties={properties.map((p) => ({ id: p.id, label: `${p.name} — ${p.city}, ${p.state}` }))}
          canManageImports={can(ctx, "canManageDroneJobs")}
        />
      </div>
    </div>
  );
}
