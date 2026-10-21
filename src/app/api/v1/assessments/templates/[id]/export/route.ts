import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { exportTemplateRows } from "@/lib/assessment-sheet-service";
import { csvResponse, toCsv } from "@/lib/csv";
import { sheetFilename } from "@/lib/sheet-filename";

type RouteParams = { params: Promise<{ id: string }> };

// GET — every assessment in your scope run on this template, as one spreadsheet.
export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const { rows, name } = await exportTemplateRows(ctx, id);
  return csvResponse(sheetFilename(name, "all-answers"), toCsv(rows));
});
