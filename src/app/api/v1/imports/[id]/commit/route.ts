import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { ApiError } from "@/lib/api-error";
import { commitImport } from "@/lib/import-service";
import { loadImportTable } from "@/lib/import/load";

type RouteParams = { params: Promise<{ id: string }> };

const schema = z.object({
  duplicateStrategy: z.enum(["SKIP", "UPDATE"]).default("SKIP"),
  targetPortfolioId: z.string().min(1).nullable().optional(),
});

// POST /api/v1/imports/[id]/commit — apply the import in one transaction.
export const POST = withApiHandler<unknown, RouteParams>(async (ctx, req, { params }) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageProperties");
  const { id } = await params;

  const job = await prisma.importJob.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!job) throw new ApiError(404, "Import job not found");

  const options = schema.parse(await req.json().catch(() => ({})));
  const table = await loadImportTable(job.storageKey, job.originalFilename);

  return commitImport({ ctx, jobId: job.id, table, options });
});
