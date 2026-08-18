// The standard "pdfkit" entrypoint reads its built-in font metrics (AFM
// files) from disk relative to __dirname at runtime — that path resolution
// breaks under Next.js/Turbopack's server bundling (__dirname gets rewritten
// to a virtual build path). The standalone build embeds font data inline
// instead of reading it from disk, so it works correctly when bundled.
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import { PropertyReportData } from "@/lib/reports/property-report-data";
import { formatCents, formatDate } from "@/lib/format";
import { withObservability } from "@/lib/observability";

function drawDocument(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return withObservability("report.generate", {}, () => new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    doc.end();
  }));
}

function sectionHeading(doc: PDFKit.PDFDocument, text: string) {
  doc.moveDown(0.75).fontSize(13).fillColor("#14181f").text(text, { underline: false });
  doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).strokeColor("#e3e7ed").stroke();
  doc.moveDown(0.5).fontSize(10).fillColor("#14181f");
}

function keyValueRow(doc: PDFKit.PDFDocument, label: string, value: string) {
  doc.fontSize(10).fillColor("#5b6472").text(label, { continued: true, width: 200 }).fillColor("#14181f").text(`  ${value}`);
}

/** Property Condition Report — PDF (spec §16, §33). */
export async function renderPropertyConditionPdf(data: PropertyReportData): Promise<Buffer> {
  return drawDocument((doc) => {
    doc.fontSize(20).fillColor("#14181f").text(data.property.name);
    doc.fontSize(10).fillColor("#5b6472").text(`${data.property.addressLine1}, ${data.property.city}, ${data.property.state}`);
    doc.text(`Generated ${formatDate(new Date())}`);

    sectionHeading(doc, "Scores");
    keyValueRow(doc, "Health Score", data.health ? `${data.health.healthScore} (${data.health.band})` : "Not yet calculated");
    keyValueRow(doc, "Risk Score", data.health ? String(data.health.riskScore) : "—");
    keyValueRow(doc, "Data Confidence", data.health ? `${Math.round(data.health.dataConfidenceScore)}%` : "—");
    keyValueRow(doc, "Capital Exposure (12mo)", data.health ? formatCents(data.health.capitalExposure12mo) : "—");
    keyValueRow(doc, "Capital Exposure (24mo)", data.health ? formatCents(data.health.capitalExposure24mo) : "—");
    keyValueRow(doc, "Capital Exposure (36mo)", data.health ? formatCents(data.health.capitalExposure36mo) : "—");

    sectionHeading(doc, "Capture Status");
    keyValueRow(doc, "Interior (Matterport)", data.interiorStatus.linked ? `Linked, last sync ${formatDate(data.interiorStatus.lastSync)}` : "Not connected");
    keyValueRow(doc, "Exterior (Drone)", data.exteriorStatus.captured ? `Captured ${formatDate(data.exteriorStatus.capturedAt)}` : "No capture uploaded");
    keyValueRow(doc, "Evidence items", String(data.evidenceCount));
    keyValueRow(doc, "Documents", String(data.documentCount));

    sectionHeading(doc, "Assessment");
    if (data.lastAssessment) {
      keyValueRow(doc, "Last completed", `${data.lastAssessment.template.name} — ${formatDate(data.lastAssessment.completedAt)}`);
    } else {
      keyValueRow(doc, "Last completed", "No completed assessment on record");
    }

    sectionHeading(doc, `Assets (${data.assets.length} shown, worst condition first)`);
    for (const asset of data.assets) {
      doc.fontSize(10).fillColor("#14181f").text(`${asset.name} — ${asset.assetType}`);
      doc
        .fontSize(9)
        .fillColor("#5b6472")
        .text(
          `Condition ${asset.conditionScore ?? "—"} · Criticality ${asset.criticalityScore}/5 · Replacement cost ${asset.replacementCost ? formatCents(asset.replacementCost) : "—"}`,
        );
      doc.moveDown(0.3);
    }
    if (data.assets.length === 0) doc.fontSize(10).fillColor("#5b6472").text("No assets recorded.");

    sectionHeading(doc, `Critical Issues (${data.criticalIssues.length} shown of ${data.openIssueCount} open)`);
    for (const issue of data.criticalIssues) {
      doc.fontSize(10).fillColor("#14181f").text(issue.title);
      doc.fontSize(9).fillColor("#5b6472").text(`Status ${issue.status} · Estimated cost ${issue.estimatedCost ? formatCents(issue.estimatedCost) : "—"}`);
      doc.moveDown(0.3);
    }
    if (data.criticalIssues.length === 0) doc.fontSize(10).fillColor("#5b6472").text("No open critical issues.");
  });
}

/** Executive Property Summary — PDF (spec §16). One-page decision-oriented view. */
export async function renderExecutiveSummaryPdf(data: PropertyReportData): Promise<Buffer> {
  return drawDocument((doc) => {
    doc.fontSize(22).fillColor("#14181f").text(data.property.name);
    doc.fontSize(11).fillColor("#5b6472").text(`${data.property.city}, ${data.property.state}`);
    doc.moveDown(1);

    doc.fontSize(36).fillColor("#2453ff").text(data.health ? String(data.health.healthScore) : "—", { continued: true });
    doc.fontSize(14).fillColor("#5b6472").text(`  / 100 Health  (${data.health?.band ?? "no data"})`);
    doc.moveDown(0.5);

    keyValueRow(doc, "Risk Score", data.health ? String(data.health.riskScore) : "—");
    keyValueRow(doc, "Data Confidence", data.health ? `${Math.round(data.health.dataConfidenceScore)}%` : "—");
    keyValueRow(doc, "Estimated Capital Exposure (12mo)", data.health ? formatCents(data.health.capitalExposure12mo) : "—");
    keyValueRow(doc, "Open Issues", String(data.openIssueCount));
    keyValueRow(doc, "Critical Issues", String(data.criticalIssues.length));

    sectionHeading(doc, "What This Means");
    const lines: string[] = [];
    if (data.health && data.health.dataConfidenceScore < 70) {
      lines.push(`Data confidence is only ${Math.round(data.health.dataConfidenceScore)}% — treat the health score as directional, not final, until more data is captured.`);
    }
    if (!data.interiorStatus.linked) lines.push("No interior (Matterport) capture is connected for this property.");
    if (!data.exteriorStatus.captured) lines.push("No exterior (drone) capture has been uploaded for this property.");
    if (data.criticalIssues.length > 0) lines.push(`${data.criticalIssues.length} critical issue(s) are currently open and driving near-term capital exposure.`);
    if (lines.length === 0) lines.push("No material data gaps or critical issues identified.");
    for (const line of lines) {
      doc.fontSize(10).fillColor("#14181f").text(`• ${line}`);
      doc.moveDown(0.2);
    }

    sectionHeading(doc, "Top Assets to Watch");
    for (const asset of data.assets.slice(0, 5)) {
      doc.fontSize(10).fillColor("#14181f").text(`${asset.name} — condition ${asset.conditionScore ?? "—"}, criticality ${asset.criticalityScore}/5`);
    }
    if (data.assets.length === 0) doc.fontSize(10).fillColor("#5b6472").text("No assets recorded.");
  });
}
