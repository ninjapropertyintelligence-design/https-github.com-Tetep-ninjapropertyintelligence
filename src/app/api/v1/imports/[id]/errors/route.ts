import { prisma } from "@/lib/prisma";
import { getSessionContext, mfaPolicySatisfied } from "@/lib/session-context";
import { requirePermission } from "@/lib/api-utils";
import { buildPreview } from "@/lib/import-service";
import { loadImportTable } from "@/lib/import/load";
import { ImportEntity } from "@/lib/import/fields";
import { csvResponse, toCsv } from "@/lib/csv";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/imports/[id]/errors — the error report (spec §68).
 *
 * CSV rather than JSON: the person fixing these is working in a spreadsheet,
 * and a row/column/reason table pastes straight alongside the file they are
 * correcting.
 *
 * Deliberately NOT wrapped in `withApiHandler` — that wrapper JSON-envelopes
 * whatever it is given, which turned this CSV into `{"data":{}}` on the
 * first run. File downloads resolve the session themselves, matching the
 * report routes. The org MFA policy is re-checked here by hand because
 * stepping outside the wrapper means stepping outside its guards too.
 */
export async function GET(_req: Request, { params }: RouteParams) {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!mfaPolicySatisfied(ctx)) {
    return new Response("Your organization requires multi-factor authentication.", { status: 403 });
  }
  if (!ctx.organizationId) return new Response("No organization context", { status: 403 });
  try {
    requirePermission(ctx, "canManageProperties");
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const { id } = await params;
  const job = await prisma.importJob.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!job) return new Response("Import job not found", { status: 404 });

  const table = await loadImportTable(job.storageKey, job.originalFilename);
  const preview = await buildPreview({
    ctx,
    entity: job.entityType as ImportEntity,
    table,
    mapping: job.columnMapping as Record<string, string>,
  });

  const rows = preview.issues.map((issue) => ({
    row: issue.rowNumber,
    column: issue.column ?? "",
    field: issue.field ?? "",
    value: issue.value ?? "",
    problem: issue.message,
  }));

  return csvResponse(
    `import-errors-${job.id}.csv`,
    rows.length > 0
      ? toCsv(rows)
      : "row,column,field,value,problem\n",
  );
}
