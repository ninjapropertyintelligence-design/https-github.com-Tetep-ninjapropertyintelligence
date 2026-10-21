import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { emitEvent, EVENT_TYPES } from "@/lib/events";
import { getStorageProvider, newObjectKey } from "@/lib/storage";
import { registerStorageObjectBestEffort } from "@/lib/storage-tiering";
import { hasPermission } from "@/lib/permissions";
import { StorageObjectKind } from "@/generated/prisma/client";
import { evidenceScopeWhere, type SessionContext } from "@/lib/tenant-scope";
import { getAssessmentDetail, progressFor } from "@/lib/assessment-service";
import { buildAssessmentReportModel, embeddableImageKind, reportPhotoIds } from "@/lib/reports/assessment-report";
import { renderAssessmentReportPdf } from "@/lib/reports/pdf-renderer";

/**
 * The survey report: one assessment as a PDF, with its photos.
 *
 * Photos are read into memory to be embedded, so they are capped — by count,
 * by size each and in total — and the report says how many were left out.
 * A function that tried to embed a thousand full-resolution photos would
 * run out of memory and give the person nothing at all.
 */

export const MAX_REPORT_PHOTOS = 200;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_PHOTO_BYTES = 150 * 1024 * 1024;

export async function generateAssessmentReport(ctx: SessionContext, assessmentId: string) {
  const assessment = await getAssessmentDetail(ctx, assessmentId);
  if (!assessment) throw new ApiError(404, "Assessment not found");
  const model = buildAssessmentReportModel(assessment, await progressFor(assessment));

  const allIds = reportPhotoIds(model);
  const included = new Set(allIds.slice(0, MAX_REPORT_PHOTOS));
  // Past the cap, photos are dropped from the model rather than drawn as
  // placeholders, so a big survey does not become pages of empty boxes.
  for (const q of model.sections.flatMap((s) => [...s.questions, ...s.tasks.flatMap((t) => t.questions)])) {
    q.photoIds = q.photoIds.filter((id) => included.has(id));
  }

  // Scoped again here: a vendor's photo still under review must not reach a
  // report just because it hangs off a visible answer.
  const rows = await prisma.evidence.findMany({
    where: { AND: [{ id: { in: [...included] } }, evidenceScopeWhere(ctx)] },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  const storage = getStorageProvider();
  const photos = new Map<string, Buffer>();
  let total = 0;
  for (const id of allIds.filter((x) => included.has(x))) {
    const row = rows.find((r) => r.id === id);
    if (!row) continue;
    const declared = row.sizeBytes === null ? null : Number(row.sizeBytes);
    if (declared !== null && (declared > MAX_PHOTO_BYTES || total + declared > MAX_TOTAL_PHOTO_BYTES)) continue;
    const bytes = await storage.readBytes(row.storageKey);
    if (!bytes || bytes.byteLength > MAX_PHOTO_BYTES || total + bytes.byteLength > MAX_TOTAL_PHOTO_BYTES) continue;
    if (!embeddableImageKind(bytes)) continue;
    photos.set(id, bytes);
    total += bytes.byteLength;
  }

  const pdf = await renderAssessmentReportPdf(model, photos, {
    generatedBy: ctx.userName,
    omittedPhotos: allIds.length - included.size,
  });

  const filenameBase = `${assessment.template.name}-${assessment.property.name}`;
  const saved = mayKeepReports(ctx)
    ? await keepReportVersion(ctx, {
        assessmentId: assessment.id,
        propertyId: assessment.property.id,
        projectId: assessment.projectId,
        title: `${assessment.template.name} report`,
        filename: `${safeFilename(filenameBase)}-report.pdf`,
        pdf,
      })
    : null;

  await Promise.all([
    writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "report.exported",
      entityType: "Assessment",
      entityId: assessment.id,
      metadata: { reportType: "assessment", format: "pdf", savedAsVersion: saved?.versionNumber ?? null },
    }),
    emitEvent({
      organizationId: ctx.organizationId,
      propertyId: assessment.property.id,
      type: EVENT_TYPES.REPORT_GENERATED,
      actorUserId: ctx.userId,
      payload: { reportType: "assessment", assessmentId: assessment.id },
    }),
  ]);
  return { pdf, filenameBase, photosIncluded: photos.size, saved };
}

export function safeFilename(name: string): string {
  return name.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "assessment";
}

/**
 * Keeping a copy is a write, so only someone who works on assessments keeps
 * one; a viewer, or support while impersonating, still gets the PDF but
 * leaves nothing behind.
 */
function mayKeepReports(ctx: SessionContext): boolean {
  return hasPermission(ctx.role, "canPerformAssessments") && !ctx.impersonation;
}

/**
 * Files the PDF as the next version of the assessment's report document,
 * creating that document on first use. It is filed under the assessment's
 * project and property, so it shows on both Documents tabs, and its version
 * list is the history of reports issued.
 */
async function keepReportVersion(
  ctx: SessionContext,
  input: { assessmentId: string; propertyId: string; projectId: string | null; title: string; filename: string; pdf: Buffer },
) {
  const storageKey = newObjectKey(ctx.organizationId, input.filename);
  await getStorageProvider().writeBytes(storageKey, input.pdf);

  const version = await prisma.$transaction(async (tx) => {
    const existing = await tx.document.findFirst({
      where: { organizationId: ctx.organizationId, assessmentId: input.assessmentId },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { versionNumber: true } } },
    });
    const document =
      existing ??
      (await tx.document.create({
        data: {
          organizationId: ctx.organizationId,
          propertyId: input.propertyId,
          projectId: input.projectId,
          assessmentId: input.assessmentId,
          title: input.title,
          documentType: "INSPECTION_REPORT",
          // Not offered as reference material on the walk: it is the output
          // of one, and would only clutter the next inspector's list.
          availableInCapture: false,
        },
      }));
    return tx.documentVersion.create({
      data: {
        documentId: document.id,
        versionNumber: (existing?.versions[0]?.versionNumber ?? 0) + 1,
        originalFilename: input.filename,
        mimeType: "application/pdf",
        sizeBytes: input.pdf.byteLength,
        storageKey,
        uploadedById: ctx.userId,
      },
    });
  });

  await registerStorageObjectBestEffort({
    organizationId: ctx.organizationId,
    storageKey,
    kind: StorageObjectKind.DOCUMENT_VERSION,
    sizeBytes: input.pdf.byteLength,
    objectCreatedAt: version.uploadedAt,
  });
  return { documentId: version.documentId, versionNumber: version.versionNumber };
}
