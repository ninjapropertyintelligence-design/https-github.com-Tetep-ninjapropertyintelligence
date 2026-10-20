import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { generateAssessmentReport } from "@/lib/reports/assessment-report-service";

type RouteParams = { params: Promise<{ id: string }> };

// GET — this assessment as a PDF report, with its photos.
export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  const { pdf, filenameBase } = await generateAssessmentReport(ctx, id);
  const filename = `${filenameBase.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "assessment"}-report.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
