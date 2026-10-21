import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { generateAssessmentReport, safeFilename } from "@/lib/reports/assessment-report-service";

type RouteParams = { params: Promise<{ id: string }> };

// GET — this assessment as a PDF report, with its photos. Each one is also kept
// as the next version of the assessment's report document.
export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const { pdf, filenameBase } = await generateAssessmentReport(ctx, id);
  const filename = `${safeFilename(filenameBase)}-report.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
