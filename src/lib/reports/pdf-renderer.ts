// The standard "pdfkit" entrypoint reads its built-in font metrics (AFM
// files) from disk relative to __dirname at runtime — that path resolution
// breaks under Next.js/Turbopack's server bundling (__dirname gets rewritten
// to a virtual build path). The standalone build embeds font data inline
// instead of reading it from disk, so it works correctly when bundled.
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import { PropertyReportData } from "@/lib/reports/property-report-data";
import type { AssessmentReportModel, ReportQuestion } from "@/lib/reports/assessment-report";
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

const PHOTOS_PER_ROW = 3;
const PHOTO_GAP = 8;
const PHOTO_HEIGHT = 120;

/** Starts a new page when the next `height` points would run off this one. */
function ensureRoom(doc: PDFKit.PDFDocument, height: number) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function drawQuestion(doc: PDFKit.PDFDocument, q: ReportQuestion, photos: Map<string, Buffer>, indent: number) {
  const left = doc.page.margins.left + indent;
  const width = doc.page.width - doc.page.margins.right - left;
  ensureRoom(doc, 30);
  doc.fontSize(10).fillColor("#14181f").text(`${q.prompt}${q.required ? " *" : ""}`, left, doc.y, { width });

  if (!q.isFileQuestion) {
    doc.fontSize(10).fillColor(q.answer ? "#14181f" : "#9aa3af").text(q.answer ?? "Not answered", left + 10, doc.y, { width: width - 10 });
    doc.moveDown(0.4);
    doc.x = doc.page.margins.left;
    return;
  }

  if (q.photoIds.length === 0) {
    doc.fontSize(10).fillColor("#9aa3af").text("No photos", left + 10, doc.y, { width: width - 10 });
    doc.moveDown(0.4);
    doc.x = doc.page.margins.left;
    return;
  }

  // A grid of thumbnails, fitted inside each cell without cropping. A photo
  // that could not be embedded still takes its cell, with the reason, so
  // the count on the page matches the count in the app.
  const cellWidth = (width - PHOTO_GAP * (PHOTOS_PER_ROW - 1)) / PHOTOS_PER_ROW;
  for (let i = 0; i < q.photoIds.length; i += PHOTOS_PER_ROW) {
    ensureRoom(doc, PHOTO_HEIGHT + PHOTO_GAP);
    const top = doc.y + 4;
    q.photoIds.slice(i, i + PHOTOS_PER_ROW).forEach((id, column) => {
      const x = left + column * (cellWidth + PHOTO_GAP);
      const bytes = photos.get(id);
      if (bytes) {
        // An ArrayBuffer, not the Node Buffer: the standalone build bundles its
        // own Buffer, fails `Buffer.isBuffer` on Node's, and falls through to
        // treating the bytes as a file path.
        const image = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        doc.image(image as unknown as Buffer, x, top, { fit: [cellWidth, PHOTO_HEIGHT], align: "center", valign: "center" });
      } else {
        doc.rect(x, top, cellWidth, PHOTO_HEIGHT).strokeColor("#e3e7ed").stroke();
        doc.fontSize(8).fillColor("#9aa3af").text("Photo not included (format or size)", x + 6, top + PHOTO_HEIGHT / 2 - 5, { width: cellWidth - 12, align: "center" });
      }
    });
    doc.x = doc.page.margins.left;
    doc.y = top + PHOTO_HEIGHT + PHOTO_GAP;
  }
  doc.moveDown(0.2);
}

/** Survey response report — one assessment, its answers and its photos, in reading order. */
export async function renderAssessmentReportPdf(
  model: AssessmentReportModel,
  photos: Map<string, Buffer>,
  meta: { generatedBy: string; omittedPhotos: number },
): Promise<Buffer> {
  return drawDocument((doc) => {
    doc.fontSize(20).fillColor("#14181f").text(model.title);
    doc.fontSize(11).fillColor("#5b6472").text(model.propertyName);
    doc.fontSize(9).text(`Generated ${formatDate(new Date())} by ${meta.generatedBy}`);

    sectionHeading(doc, "Summary");
    keyValueRow(doc, "Status", model.status.replace(/_/g, " "));
    keyValueRow(doc, "Inspector", model.inspectorName);
    if (model.scheduledFor) keyValueRow(doc, "Scheduled", formatDate(model.scheduledFor));
    if (model.startedAt) keyValueRow(doc, "Started", formatDate(model.startedAt));
    if (model.completedAt) keyValueRow(doc, "Completed", formatDate(model.completedAt));
    if (model.releasedAt) keyValueRow(doc, "Released", formatDate(model.releasedAt));
    const p = model.progress;
    if (p.requiredTasks > 0 || p.taskResponses > 0) {
      keyValueRow(doc, "Required tasks complete", `${p.requiredTasksComplete} of ${p.requiredTasks}`);
      keyValueRow(doc, "Task responses", `${p.taskResponsesComplete} complete, ${p.taskResponsesIncomplete} incomplete`);
    }
    if (p.requiredQuestions > 0) keyValueRow(doc, "Required questions answered", `${p.requiredQuestionsAnswered} of ${p.requiredQuestions}`);
    keyValueRow(doc, "Photos", String(p.photos));
    if (meta.omittedPhotos > 0) {
      doc.moveDown(0.3).fontSize(9).fillColor("#9aa3af").text(`${meta.omittedPhotos} further photo(s) are not included to keep this report a manageable size; see them in the app.`);
    }

    for (const section of model.sections) {
      if (section.questions.length === 0 && section.tasks.length === 0) continue;
      ensureRoom(doc, 60);
      sectionHeading(doc, section.name);
      for (const q of section.questions) drawQuestion(doc, q, photos, 0);
      for (const task of section.tasks) {
        ensureRoom(doc, 50);
        doc.moveDown(0.3);
        doc
          .fontSize(11)
          .fillColor("#14181f")
          .text(`${task.taskName}${task.heading ? `  ${task.heading}` : ""}`, doc.page.margins.left, doc.y, { continued: true })
          .fontSize(9)
          .fillColor(task.complete ? "#1a9c5c" : "#9aa3af")
          .text(`   ${task.complete ? "Complete" : "Incomplete"}`);
        doc.moveDown(0.2);
        for (const q of task.questions) drawQuestion(doc, q, photos, 12);
      }
    }

    if (model.notStarted.length > 0) {
      ensureRoom(doc, 60);
      sectionHeading(doc, "Not started");
      for (const line of model.notStarted) doc.fontSize(10).fillColor("#5b6472").text(`• ${line}`);
    }
  });
}
