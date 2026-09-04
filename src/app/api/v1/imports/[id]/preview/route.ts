import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { ApiError } from "@/lib/api-error";
import { buildPreview } from "@/lib/import-service";
import { loadImportTable } from "@/lib/import/load";
import { ImportEntity } from "@/lib/import/fields";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({ mapping: z.record(z.string(), z.string()).optional() });

/**
 * POST /api/v1/imports/[id]/preview — validate, dedup, and summarise without
 * writing anything (spec §68 "Preview", "Validation", "Duplicate detection").
 *
 * POST rather than GET because the caller supplies a candidate column
 * mapping to preview; it is still side-effect-free apart from remembering
 * the mapping on the job.
 */
export const POST = withApiHandler<unknown, RouteParams>(async (ctx, req, { params }) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageProperties");
  const { id } = await params;

  const job = await prisma.importJob.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!job) throw new ApiError(404, "Import job not found");

  const body = await req.json().catch(() => ({}));
  const { mapping } = schema.parse(body);

  const table = await loadImportTable(job.storageKey, job.originalFilename);
  const preview = await buildPreview({
    ctx,
    entity: job.entityType as ImportEntity,
    table,
    mapping: mapping ?? (job.columnMapping as Record<string, string>),
  });

  await prisma.importJob.update({
    where: { id: job.id },
    data: {
      columnMapping: preview.mapping,
      status: preview.totals.errors > 0 ? "PREVIEWED" : "VALIDATED",
      rowCount: preview.totals.rows,
      errorCount: preview.totals.errors,
      duplicateCount: preview.totals.duplicates,
    },
  });

  return preview;
});
