import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgContext, requirePermission, withApiHandler } from "@/lib/api-utils";
import { ApiError } from "@/lib/api-error";
import { getStorageProvider } from "@/lib/storage";
import { ImportParseError, MAX_IMPORT_BYTES, detectFormat, parseImportFile } from "@/lib/import/parse";
import { suggestMapping } from "@/lib/import/fields";
import { writeAuditLog } from "@/lib/audit";

// GET /api/v1/imports — recent import jobs for this organization.
export const GET = withApiHandler(async (ctx) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageProperties");
  const items = await prisma.importJob.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  return { items };
});

/**
 * POST /api/v1/imports — upload a spreadsheet and create an import job.
 *
 * The file is small by policy (see MAX_IMPORT_BYTES), so it is accepted as
 * multipart directly rather than through the signed direct-upload flow the
 * large capture files use. It is stored so the commit step can re-read
 * exactly the bytes the preview was built from.
 */
export const POST = withApiHandler(async (ctx, req) => {
  requireOrgContext(ctx);
  requirePermission(ctx, "canManageProperties");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const entityType = String(form?.get("entityType") ?? "PROPERTIES");
  const targetPortfolioId = form?.get("targetPortfolioId") ? String(form.get("targetPortfolioId")) : null;

  if (!(file instanceof File)) throw new ApiError(400, "Attach a .csv, .tsv, or .xlsx file");
  if (entityType !== "PROPERTIES" && entityType !== "ASSETS") {
    throw new ApiError(400, "entityType must be PROPERTIES or ASSETS");
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ApiError(400, `That file is too large. The limit is ${MAX_IMPORT_BYTES / 1024 / 1024}MB.`);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let table;
  try {
    detectFormat(file.name);
    table = await parseImportFile(file.name, bytes);
  } catch (err) {
    // Parse failures are the user's file being wrong, not a server error.
    if (err instanceof ImportParseError) throw new ApiError(400, err.message);
    throw err;
  }

  const storage = getStorageProvider();
  const storageKey = `${ctx.organizationId}/imports/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await storage.writeBytes(storageKey, bytes);

  const job = await prisma.importJob.create({
    data: {
      organizationId: ctx.organizationId,
      entityType,
      originalFilename: file.name,
      storageKey,
      columnMapping: suggestMapping(table.headers, entityType),
      rowCount: table.rows.length,
      targetPortfolioId,
      createdById: ctx.userId,
    },
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "import.uploaded",
    entityType: "ImportJob",
    entityId: job.id,
    metadata: { filename: file.name, entityType, rows: table.rows.length },
  });

  return NextResponse.json(job, { status: 201 });
});
