import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { importAnswers } from "@/lib/assessment-sheet-service";
import { ImportParseError, MAX_IMPORT_BYTES, parseImportFile } from "@/lib/import/parse";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST — load answers from a filled-in export (.csv, .tsv or .xlsx).
 * Form fields: `file`, and `dryRun=true` to check without saving.
 */
export const POST = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Attach the filled-in .csv, .tsv or .xlsx file");
  if (file.size > MAX_IMPORT_BYTES) throw new ApiError(400, `That file is too large. The limit is ${MAX_IMPORT_BYTES / 1024 / 1024}MB.`);
  let table;
  try {
    table = await parseImportFile(file.name, Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof ImportParseError) throw new ApiError(400, err.message);
    throw err;
  }
  return NextResponse.json(await importAnswers(ctx, id, table, { dryRun: form?.get("dryRun") === "true" }));
});
