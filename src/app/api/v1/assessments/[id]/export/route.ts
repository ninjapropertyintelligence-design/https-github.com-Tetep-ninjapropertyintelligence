import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { exportAssessmentRows } from "@/lib/assessment-sheet-service";
import { csvResponse, toCsv } from "@/lib/csv";
import { sheetFilename } from "@/lib/sheet-filename";

type RouteParams = { params: Promise<{ id: string }> };

// GET — this assessment as a spreadsheet: one row per question per task response.
export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const { rows, name } = await exportAssessmentRows(ctx, id);
  return csvResponse(sheetFilename(name, "answers"), toCsv(rows));
});
