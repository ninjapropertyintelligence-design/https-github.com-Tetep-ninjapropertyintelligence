import { redirect } from "next/navigation";
import { can, getSessionContext } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { ASSET_FIELDS, PROPERTY_FIELDS } from "@/lib/import/fields";
import { ImportWizard } from "@/components/import/ImportWizard";
import { recordProductEvent } from "@/lib/analytics";

/**
 * Bulk import (spec §68/§69), the step between "Organization Created" and
 * "Customer Live" in the §67 onboarding flow.
 */
export default async function ImportsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.organizationId || !can(ctx, "canManageProperties")) redirect("/dashboard");

  // Product analytics (§105). Awaited but never able to throw, and
  // flagged automatically when the viewer is support impersonating.
  await recordProductEvent(ctx, "import.wizard_started");
  const [portfolios, jobs] = await Promise.all([
    prisma.portfolio.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.importJob.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  const toOption = (f: { key: string; label: string; required: boolean; help?: string }) => ({
    key: f.key,
    label: f.label,
    required: f.required,
    help: f.help,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Import Data</h1>
        <p className="text-sm text-muted">Bring properties and assets in from a spreadsheet.</p>
      </div>

      <div className="max-w-5xl">
        <ImportWizard
          fields={{ PROPERTIES: PROPERTY_FIELDS.map(toOption), ASSETS: ASSET_FIELDS.map(toOption) }}
          portfolios={portfolios}
          jobs={jobs.map((j) => ({
            id: j.id,
            entityType: j.entityType,
            status: j.status,
            originalFilename: j.originalFilename,
            rowCount: j.rowCount,
            successCount: j.successCount,
            errorCount: j.errorCount,
            duplicateCount: j.duplicateCount,
            createdAt: j.createdAt,
            completedAt: j.completedAt,
            undoneAt: j.undoneAt,
          }))}
        />
      </div>
    </div>
  );
}
