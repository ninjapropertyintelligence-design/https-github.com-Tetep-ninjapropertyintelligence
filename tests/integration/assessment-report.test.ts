import { afterAll, beforeAll, describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { getStorageProvider } from "@/lib/storage";
import { createEvidence } from "@/lib/evidence-service";
import { addTaskResponse, saveAnswer } from "@/lib/assessment-service";
import { generateAssessmentReport } from "@/lib/reports/assessment-report-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * The survey PDF. What goes wrong without these rules: a report that leaves
 * out repeats of a task, hides what was never started, crashes on a photo
 * format PDF cannot hold, or shows a photo to someone who could not open it
 * in the app.
 */

const suffix = `ar${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let property: { id: string };
let otherProperty: { id: string };
let inspector: { id: string };
let assessmentId: string;

function ctx(userId: string, role: Role, propertyId?: string): SessionContext {
  return {
    userId,
    userName: "Ivy Report",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Report Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: [{ scopeType: "PROPERTY", propertyId: propertyId ?? property.id, portfolioId: null, regionId: null }],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}
const asInspector = () => ctx(inspector.id, Role.INSPECTOR);

/** A real, decodable 4x3 PNG. */
function png(): Buffer {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(3, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.concat(Array.from({ length: 3 }, () => Buffer.from([0, ...Array(12).fill(120)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function photo(answerId: string, bytes: Buffer, name: string) {
  const key = `${org.id}/${crypto.randomUUID()}-${name}`;
  await getStorageProvider().writeBytes(key, bytes);
  return createEvidence(asInspector(), { type: "PHOTO", storageKey: key, sizeBytes: bytes.length, propertyId: property.id, assessmentAnswerId: answerId });
}

async function pdfText(pdf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: pdf });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `AR ${suffix}`, slug: `ar-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
    });
  property = await mk("Kwik Shop");
  otherProperty = await mk("Elsewhere");
  inspector = await prisma.user.create({ data: { email: `insp-${suffix}@example.com`, name: "Ivy Report", passwordHash: "x" } });
  const template = await prisma.assessmentTemplate.create({ data: { organizationId: org.id, name: "Site Survey" } });
  const section = await prisma.assessmentSection.create({ data: { templateId: template.id, name: "MEP" } });
  const drain = await prisma.assessmentTask.create({ data: { sectionId: section.id, name: "Roof drain", isRepeatable: true } });
  await prisma.assessmentTask.create({ data: { sectionId: section.id, name: "Water heater", position: 1 } });
  const drainPhoto = await prisma.assessmentQuestion.create({ data: { sectionId: section.id, taskId: drain.id, prompt: "Drain photo", type: "PHOTO", isRequired: true } });
  const clear = await prisma.assessmentQuestion.create({ data: { sectionId: section.id, taskId: drain.id, prompt: "Drain clear?", type: "YES_NO", position: 1 } });

  assessmentId = (
    await prisma.assessment.create({
      data: { organizationId: org.id, propertyId: property.id, templateId: template.id, inspectorId: inspector.id },
    })
  ).id;
  const north = await addTaskResponse(asInspector(), assessmentId, { taskId: drain.id, label: "North" });
  const south = await addTaskResponse(asInspector(), assessmentId, { taskId: drain.id, label: "South" });
  await saveAnswer(asInspector(), assessmentId, { questionId: clear.id, taskResponseId: north.id, boolValue: true });
  await saveAnswer(asInspector(), assessmentId, { questionId: clear.id, taskResponseId: south.id, boolValue: false });
  const answer = await saveAnswer(asInspector(), assessmentId, { questionId: drainPhoto.id, taskResponseId: north.id });
  await photo(answer.id, png(), "drain.png");
  // Not a format PDF can hold: it must become a labelled placeholder, not a crash.
  await photo(answer.id, Buffer.from("RIFF0000WEBPVP8 not really"), "drain.webp");
});

afterAll(async () => {
  await prisma.evidence.deleteMany({ where: { organizationId: org.id } });
  await prisma.assessment.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@example.com` } } });
});

describe("survey PDF report", () => {
  it("contains every repeat of a task, its answers, and what was never started", async () => {
    const { pdf, photosIncluded } = await generateAssessmentReport(asInspector(), assessmentId);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(photosIncluded).toBe(1);

    const text = await pdfText(pdf);
    for (const expected of ["Site Survey", "Roof drain", "#1 North", "#2 South", "Drain clear?", "Yes", "No", "Not started", "Water heater (required)", "Photo not included", "Generated", "Ivy Report"]) {
      expect(text, expected).toContain(expected);
    }
  });

  it("is not available to someone who cannot open the assessment", async () => {
    await expect(generateAssessmentReport(ctx(inspector.id, Role.INSPECTOR, otherProperty.id), assessmentId)).rejects.toThrow(/not found/);
  });

  it("is recorded in the audit log and the property history", async () => {
    await generateAssessmentReport(asInspector(), assessmentId);
    expect(await prisma.auditLog.count({ where: { entityId: assessmentId, action: "report.exported" } })).toBeGreaterThan(0);
    expect(await prisma.event.count({ where: { propertyId: property.id, type: "report.generated" } })).toBeGreaterThan(0);
  });
});
