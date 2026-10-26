import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { buildPreview, commitImport, rollbackImport } from "@/lib/import-service";
import { parseImportFile } from "@/lib/import/parse";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Bulk project import. What goes wrong without these rules: a program or
 * property misspelled in the sheet silently producing orphan projects; the
 * same project imported twice when the sheet is re-run; and an import that
 * cannot be undone after it lands 300 projects in the wrong program.
 */

const suffix = `pji${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let user: { id: string };
let store: { id: string };
let program: { id: string };

function ctxFor(): SessionContext {
  return {
    userId: user.id,
    userName: "Importer",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Project Import Org",
    membershipId: "irrelevant",
    role: Role.OWNER,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

const MAPPING = { Store: "propertyRef", Project: "name", Program: "program", Status: "status", Start: "startDate", End: "endDate", Type: "projectType" };
const HEADERS = "Store,Project,Program,Status,Start,End,Type";

async function newJob() {
  return prisma.importJob.create({
    data: {
      organizationId: org.id,
      entityType: "PROJECTS",
      originalFilename: "projects.csv",
      storageKey: `${org.id}/import-${Math.random().toString(36).slice(2)}.csv`,
      columnMapping: MAPPING,
      createdById: user.id,
    },
  });
}

const table = (rows: string[]) => parseImportFile("projects.csv", Buffer.from([HEADERS, ...rows].join("\n")));

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `PJI ${suffix}`, slug: `pji-${suffix}` } });
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "Importer" } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  store = await prisma.property.create({
    data: { organizationId: org.id, portfolioId: pf.id, name: "Kwik Shop 350711", customerPropertyId: "KS-350711", addressLine1: "1", city: "Park City", state: "KS", postalCode: "67219" },
  });
  program = await prisma.program.create({ data: { organizationId: org.id, name: "2026 Essential" } });
});

beforeEach(async () => {
  await prisma.project.deleteMany({ where: { organizationId: org.id } });
  await prisma.importJob.deleteMany({ where: { organizationId: org.id } });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
});

describe("previewing a project sheet", () => {
  it("flags an unknown property, an unknown program, a bad status and backwards dates per row", async () => {
    const preview = await buildPreview({
      ctx: ctxFor(),
      entity: "PROJECTS",
      table: await table([
        "KS-350711,Full capture,2026 Essential,In Progress,2026-01-05,2026-02-01,Full Capture",
        "NOPE-1,Survey,2026 Essential,New,,,",
        "KS-350711,Retrofit,Wrong Program,New,,,",
        "KS-350711,Paint,,Someday,,,",
        "KS-350711,Roof,,New,2026-03-01,2026-02-01,",
      ]),
      mapping: MAPPING,
    });
    expect(preview.totals).toMatchObject({ rows: 5, ok: 1, errors: 4 });
    expect(preview.issues.map((i) => [i.rowNumber, i.field])).toEqual([
      [2, "propertyRef"],
      [3, "program"],
      [4, "status"],
      [5, "endDate"],
    ]);
  });
});

describe("committing a project sheet", () => {
  it("skips the rows the preview called errors instead of failing the import", async () => {
    const job = await newJob();
    const result = await commitImport({
      ctx: ctxFor(),
      jobId: job.id,
      table: await table(["KS-350711,Kept,,New,,,", "NOPE-1,Unknown site,,New,,,", "KS-350711,Typo program,Wrong Program,New,,,"]),
      options: { duplicateStrategy: "SKIP" },
    });
    expect(result).toMatchObject({ created: 1, errors: 2 });
    expect((await prisma.project.findMany({ where: { organizationId: org.id } })).map((p) => p.name)).toEqual(["Kept"]);
  });

  it("creates projects at the right property and program, by customer id or name, and rolls back", async () => {
    const job = await newJob();
    const result = await commitImport({
      ctx: ctxFor(),
      jobId: job.id,
      table: await table([
        "KS-350711,Full capture,2026 Essential,In Progress,2026-01-05,2026-02-01,Full Capture",
        "Kwik Shop 350711,Survey only,,,,,",
      ]),
      options: { duplicateStrategy: "SKIP" },
    });
    expect(result).toMatchObject({ created: 2, errors: 0 });
    const projects = await prisma.project.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } });
    expect(projects.map((p) => [p.name, p.propertyId, p.programId, p.status, p.startDate?.toISOString().slice(0, 10) ?? null])).toEqual([
      ["Full capture", store.id, program.id, "IN_PROGRESS", "2026-01-05"],
      ["Survey only", store.id, null, "NEW", null],
    ]);

    await rollbackImport({ ctx: ctxFor(), jobId: job.id });
    expect(await prisma.project.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("matches a re-imported project instead of creating it twice, and can update it", async () => {
    const first = await newJob();
    await commitImport({ ctx: ctxFor(), jobId: first.id, table: await table(["KS-350711,Full capture,,New,,,"]), options: { duplicateStrategy: "SKIP" } });

    // Same project, named by the property's name this time.
    const second = await newJob();
    const skipped = await commitImport({
      ctx: ctxFor(),
      jobId: second.id,
      table: await table(["Kwik Shop 350711,Full capture,2026 Essential,Completed,,,"]),
      options: { duplicateStrategy: "SKIP" },
    });
    expect(skipped).toMatchObject({ created: 0, skipped: 1 });

    const third = await newJob();
    const updated = await commitImport({
      ctx: ctxFor(),
      jobId: third.id,
      table: await table(["KS-350711,Full capture,2026 Essential,Completed,,2026-04-30,"]),
      options: { duplicateStrategy: "UPDATE" },
    });
    expect(updated).toMatchObject({ created: 0, updated: 1 });
    const project = await prisma.project.findFirstOrThrow({ where: { organizationId: org.id } });
    expect([project.status, project.programId, project.endDate?.toISOString().slice(0, 10)]).toEqual(["COMPLETED", program.id, "2026-04-30"]);

    // Undoing the update restores exactly what it changed.
    await rollbackImport({ ctx: ctxFor(), jobId: third.id });
    const restored = await prisma.project.findFirstOrThrow({ where: { organizationId: org.id } });
    expect([restored.status, restored.programId, restored.endDate]).toEqual(["NEW", null, null]);
  });
});
