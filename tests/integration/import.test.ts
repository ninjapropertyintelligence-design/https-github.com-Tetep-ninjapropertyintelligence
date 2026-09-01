import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { Role } from "@/generated/prisma/client";
import { buildPreview, commitImport, rollbackImport } from "@/lib/import-service";
import { parseImportFile } from "@/lib/import/parse";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * The import pipeline against real Postgres (spec §68/§69).
 *
 * The cases that matter most are the destructive ones: that a duplicate
 * never silently creates a second property, that a failure part-way through
 * leaves nothing behind, and that a rollback restores exactly what the
 * import changed and nothing else.
 */
const suffix = `imp${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let org: { id: string };
let user: { id: string };
let portfolioId: string;

function ctxFor(): SessionContext {
  return {
    userId: user.id,
    userName: "Import User",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Import Org",
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

const csv = (body: string) => Buffer.from(body);

async function newJob(entityType: "PROPERTIES" | "ASSETS", mapping: Record<string, string>) {
  return prisma.importJob.create({
    data: {
      organizationId: org.id,
      entityType,
      originalFilename: "portfolio.csv",
      storageKey: `${org.id}/import-${Math.random().toString(36).slice(2)}.csv`,
      columnMapping: mapping,
      createdById: user.id,
      targetPortfolioId: portfolioId,
    },
  });
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `Imp Org ${suffix}`, slug: `imp-org-${suffix}` } });
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "Import User" } });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: Role.OWNER } });
  const portfolio = await prisma.portfolio.create({ data: { organizationId: org.id, name: "Main Portfolio" } });
  portfolioId = portfolio.id;
});

beforeEach(async () => {
  await prisma.property.deleteMany({ where: { organizationId: org.id } });
  await prisma.importJob.deleteMany({ where: { organizationId: org.id } });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
});

const HEADERS = "Store Name,Customer ID,Address,City,State,Zip,Year Built";
const MAPPING = {
  "Store Name": "name",
  "Customer ID": "customerPropertyId",
  Address: "addressLine1",
  City: "city",
  State: "state",
  Zip: "postalCode",
  "Year Built": "yearBuilt",
};

describe("field mapping (§68)", () => {
  it("auto-detects columns from their headers", async () => {
    const table = await parseImportFile("p.csv", csv(`${HEADERS}\nStore #1052,STORE-1052,1200 Main St,Dallas,TX,75201,1998\n`));
    const preview = await buildPreview({ ctx: ctxFor(), entity: "PROPERTIES", table });

    expect(preview.mapping).toMatchObject({
      "Store Name": "name",
      Address: "addressLine1",
      City: "city",
      State: "state",
      Zip: "postalCode",
      "Year Built": "yearBuilt",
    });
    expect(preview.missingRequired).toEqual([]);
  });

  it("reports required fields that no column maps to, instead of importing blanks", async () => {
    const table = await parseImportFile("p.csv", csv("Store Name,Notes\nStore #1052,hello\n"));
    const preview = await buildPreview({ ctx: ctxFor(), entity: "PROPERTIES", table });
    expect(preview.missingRequired).toEqual(expect.arrayContaining(["Address", "City", "State", "Postal code"]));
  });

  it("does not map two similar headers onto the same target field", async () => {
    const table = await parseImportFile("p.csv", csv("Property ID,Customer Property ID\nA,B\n"));
    const preview = await buildPreview({ ctx: ctxFor(), entity: "PROPERTIES", table });
    const targets = Object.values(preview.mapping);
    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe("validation and error reporting (§68)", () => {
  it("reports the row, column, and reason for each bad value", async () => {
    const table = await parseImportFile(
      "p.csv",
      csv(`${HEADERS}\nStore #1052,STORE-1052,1200 Main St,Dallas,ZZ,75201,1998\nStore #1053,STORE-1053,9 Oak,Austin,TX,ABCDE,3050\n`),
    );
    const preview = await buildPreview({ ctx: ctxFor(), entity: "PROPERTIES", table, mapping: MAPPING });

    const stateIssue = preview.issues.find((i) => i.field === "state");
    expect(stateIssue).toMatchObject({ rowNumber: 1, column: "State" });
    expect(stateIssue?.message).toMatch(/not a US state/);

    expect(preview.issues.find((i) => i.field === "postalCode")).toMatchObject({ rowNumber: 2, column: "Zip" });
    expect(preview.issues.find((i) => i.field === "yearBuilt")?.message).toMatch(/between/);
    expect(preview.totals.errors).toBe(2);
  });

  it("accepts full state names and ZIP+4, which real files are full of", async () => {
    const table = await parseImportFile("p.csv", csv(`${HEADERS}\nStore #1052,STORE-1052,1200 Main St,Dallas,Texas,75201-4432,1998\n`));
    const preview = await buildPreview({ ctx: ctxFor(), entity: "PROPERTIES", table, mapping: MAPPING });
    expect(preview.totals.errors).toBe(0);
    expect(preview.rows[0].values.state).toBe("TX");
  });

  it("keeps a leading-zero postal code as text", async () => {
    const table = await parseImportFile("p.csv", csv(`${HEADERS}\nHoboken,H-1,1 River St,Hoboken,NJ,07030,1990\n`));
    const preview = await buildPreview({ ctx: ctxFor(), entity: "PROPERTIES", table, mapping: MAPPING });
    expect(preview.rows[0].values.postalCode).toBe("07030");
  });
});

describe("reference columns must resolve, not silently fall back", () => {
  it("flags an unknown portfolio at PREVIEW time, before anything is written", async () => {
    // Regression: a row naming a portfolio that does not exist silently fell
    // back to the import's default portfolio, filing the property somewhere
    // nobody would think to look.
    const table = await parseImportFile(
      "p.csv",
      csv(`${HEADERS},Portfolio\nStore #1052,STORE-1052,1200 Main St,Dallas,TX,75201,1998,No Such Portfolio\n`),
    );
    const preview = await buildPreview({ ctx: ctxFor(), entity: "PROPERTIES", table, mapping: { ...MAPPING, Portfolio: "portfolio" } });

    expect(preview.issues.find((i) => i.field === "portfolio")?.message).toMatch(/No portfolio named/);
    expect(preview.totals.errors).toBe(1);
  });

  it("flags an unknown region the same way", async () => {
    const table = await parseImportFile(
      "p.csv",
      csv(`${HEADERS},Region\nStore #1052,STORE-1052,1200 Main St,Dallas,TX,75201,1998,Atlantis\n`),
    );
    const preview = await buildPreview({ ctx: ctxFor(), entity: "PROPERTIES", table, mapping: { ...MAPPING, Region: "region" } });
    expect(preview.issues.find((i) => i.field === "region")?.message).toMatch(/No region named/);
  });

  it("uses the import's default portfolio when a row names none", async () => {
    const table = await parseImportFile("p.csv", csv(`${HEADERS}\nStore #1052,STORE-1052,1200 Main St,Dallas,TX,75201,1998\n`));
    const job = await newJob("PROPERTIES", MAPPING);
    await commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "SKIP" } });
    const created = await prisma.property.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(created.portfolioId).toBe(portfolioId);
  });
});

describe("preview then commit (§68)", () => {
  it("writes nothing during preview", async () => {
    const table = await parseImportFile("p.csv", csv(`${HEADERS}\nStore #1052,STORE-1052,1200 Main St,Dallas,TX,75201,1998\n`));
    await buildPreview({ ctx: ctxFor(), entity: "PROPERTIES", table, mapping: MAPPING });
    expect(await prisma.property.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("creates the rows on commit and records what it did", async () => {
    const table = await parseImportFile(
      "p.csv",
      csv(`${HEADERS}\nStore #1052,STORE-1052,1200 Main St,Dallas,TX,75201,1998\nStore #2210,STORE-2210,88 Oak Ave,Austin,TX,78701,2005\n`),
    );
    const job = await newJob("PROPERTIES", MAPPING);
    const result = await commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "SKIP" } });

    expect(result).toMatchObject({ created: 2, updated: 0, skipped: 0, errors: 0 });
    expect(await prisma.property.count({ where: { organizationId: org.id } })).toBe(2);

    const rowResults = await prisma.importRowResult.findMany({ where: { importJobId: job.id } });
    expect(rowResults).toHaveLength(2);
    expect(rowResults.every((r) => r.action === "CREATED" && r.entityId)).toBe(true);

    const updatedJob = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("COMPLETED");
    expect(updatedJob.successCount).toBe(2);
  });

  it("refuses to commit twice", async () => {
    const table = await parseImportFile("p.csv", csv(`${HEADERS}\nStore #1052,STORE-1052,1200 Main St,Dallas,TX,75201,1998\n`));
    const job = await newJob("PROPERTIES", MAPPING);
    await commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "SKIP" } });
    await expect(
      commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "SKIP" } }),
    ).rejects.toThrow(/already been applied/);
  });

  it("cannot touch another organization's import job", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: `Imp Other ${suffix}`, slug: `imp-other-${suffix}` } });
    try {
      const foreign = await prisma.importJob.create({
        data: {
          organizationId: otherOrg.id,
          entityType: "PROPERTIES",
          originalFilename: "x.csv",
          storageKey: "x",
          columnMapping: MAPPING,
          createdById: user.id,
        },
      });
      const table = await parseImportFile("p.csv", csv(`${HEADERS}\nStore,S-1,1 Main St,Dallas,TX,75201,1998\n`));
      await expect(
        commitImport({ ctx: ctxFor(), jobId: foreign.id, table, options: { duplicateStrategy: "SKIP" } }),
      ).rejects.toThrow(ApiError);
    } finally {
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });
});

describe("duplicate handling (§69) — the three-spellings problem", () => {
  const THREE_SPELLINGS = `${HEADERS}
Store 1052,,1200 Main St,Dallas,TX,75201,1998
Store #1052,,1200 Main St,Dallas,TX,75201,1998
Store-1052,,1200 Main St,Dallas,TX,75201,1998
`;

  it("imports the spec's three spellings as ONE property, not three", async () => {
    const table = await parseImportFile("p.csv", csv(THREE_SPELLINGS));
    const job = await newJob("PROPERTIES", MAPPING);
    const result = await commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "SKIP" } });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(2);
    expect(await prisma.property.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("flags them in the preview before anything is written", async () => {
    const table = await parseImportFile("p.csv", csv(THREE_SPELLINGS));
    const preview = await buildPreview({ ctx: ctxFor(), entity: "PROPERTIES", table, mapping: MAPPING });
    expect(preview.totals.duplicates).toBe(2);
    expect(preview.rows[1].duplicateOfRow).toBe(1);
    expect(preview.rows[2].duplicateOfRow).toBe(1);
  });

  it("skips a row matching an EXISTING property rather than creating a second one", async () => {
    await prisma.property.create({
      data: {
        organizationId: org.id,
        portfolioId,
        name: "Store #1052",
        customerPropertyId: "STORE-1052",
        addressLine1: "1200 Main St",
        city: "Dallas",
        state: "TX",
        postalCode: "75201",
      },
    });

    const table = await parseImportFile("p.csv", csv(`${HEADERS}\nStore-1052,STORE-1052,1200 Main Street Suite 4,Dallas,TX,75201,1998\n`));
    const job = await newJob("PROPERTIES", MAPPING);
    const result = await commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "SKIP" } });

    expect(result).toMatchObject({ created: 0, skipped: 1 });
    expect(await prisma.property.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("updates the existing property instead when asked to", async () => {
    const existing = await prisma.property.create({
      data: {
        organizationId: org.id,
        portfolioId,
        name: "Store #1052",
        customerPropertyId: "STORE-1052",
        addressLine1: "1200 Main St",
        city: "Dallas",
        state: "TX",
        postalCode: "75201",
        yearBuilt: 1990,
      },
    });

    const table = await parseImportFile("p.csv", csv(`${HEADERS}\nStore-1052,STORE-1052,1200 Main St,Dallas,TX,75201,1998\n`));
    const job = await newJob("PROPERTIES", MAPPING);
    const result = await commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "UPDATE" } });

    expect(result).toMatchObject({ created: 0, updated: 1 });
    const after = await prisma.property.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.yearBuilt).toBe(1998);
    expect(await prisma.property.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("never auto-creates for a NEEDS_REVIEW match — same name, different city", async () => {
    await prisma.property.create({
      data: {
        organizationId: org.id,
        portfolioId,
        name: "Store #1052",
        addressLine1: "1200 Main St",
        city: "Dallas",
        state: "TX",
        postalCode: "75201",
      },
    });

    const table = await parseImportFile("p.csv", csv(`${HEADERS}\nStore #1052,,500 Desert Rd,Phoenix,AZ,85001,2001\n`));
    const job = await newJob("PROPERTIES", MAPPING);
    const result = await commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "SKIP" } });

    // Ambiguous rows are held back rather than guessed at in either direction.
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

describe("rollback (§68)", () => {
  it("is atomic — a failing row leaves nothing behind", async () => {
    // Row 2 names a portfolio that does not exist, which throws mid-commit.
    const table = await parseImportFile(
      "p.csv",
      csv(
        `${HEADERS},Portfolio\nStore #1052,STORE-1052,1200 Main St,Dallas,TX,75201,1998,Main Portfolio\nStore #2210,STORE-2210,88 Oak Ave,Austin,TX,78701,2005,No Such Portfolio\n`,
      ),
    );
    const job = await newJob("PROPERTIES", { ...MAPPING, Portfolio: "portfolio" });

    await expect(
      commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "SKIP" } }),
    ).rejects.toThrow(/No Such Portfolio/);

    // The first row succeeded before the second threw; the transaction must
    // have undone it. Without the transaction this would be 1.
    expect(await prisma.property.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("deletes created records and restores updated ones", async () => {
    const existing = await prisma.property.create({
      data: {
        organizationId: org.id,
        portfolioId,
        name: "Store #1052",
        customerPropertyId: "STORE-1052",
        addressLine1: "1200 Main St",
        city: "Dallas",
        state: "TX",
        postalCode: "75201",
        yearBuilt: 1990,
      },
    });

    const table = await parseImportFile(
      "p.csv",
      csv(`${HEADERS}\nStore-1052,STORE-1052,1200 Main St,Dallas,TX,75201,1998\nStore #3000,STORE-3000,7 New Way,Reno,NV,89501,2010\n`),
    );
    const job = await newJob("PROPERTIES", MAPPING);
    const result = await commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "UPDATE" } });
    expect(result).toMatchObject({ created: 1, updated: 1 });
    expect(await prisma.property.count({ where: { organizationId: org.id } })).toBe(2);

    const undo = await rollbackImport({ ctx: ctxFor(), jobId: job.id });
    expect(undo).toMatchObject({ deleted: 1, restored: 1 });

    // The created property is gone...
    expect(await prisma.property.count({ where: { organizationId: org.id } })).toBe(1);
    // ...and the updated one has its original value back.
    const after = await prisma.property.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.yearBuilt).toBe(1990);
    expect(after.name).toBe("Store #1052");

    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("ROLLED_BACK");
  });

  it("restores only the fields the import changed, preserving later edits", async () => {
    const existing = await prisma.property.create({
      data: {
        organizationId: org.id,
        portfolioId,
        name: "Store #1052",
        customerPropertyId: "STORE-1052",
        addressLine1: "1200 Main St",
        city: "Dallas",
        state: "TX",
        postalCode: "75201",
        yearBuilt: 1990,
      },
    });

    const table = await parseImportFile("p.csv", csv(`${HEADERS}\nStore-1052,STORE-1052,1200 Main St,Dallas,TX,75201,1998\n`));
    const job = await newJob("PROPERTIES", MAPPING);
    await commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "UPDATE" } });

    // Someone edits an unrelated field after the import.
    await prisma.property.update({ where: { id: existing.id }, data: { squareFootage: 42000 } });

    await rollbackImport({ ctx: ctxFor(), jobId: job.id });

    const after = await prisma.property.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.yearBuilt).toBe(1990); // restored
    expect(after.squareFootage).toBe(42000); // NOT clobbered by the undo
  });

  it("refuses to roll back an import that was never completed", async () => {
    const job = await newJob("PROPERTIES", MAPPING);
    await expect(rollbackImport({ ctx: ctxFor(), jobId: job.id })).rejects.toThrow(/completed import/);
  });

  it("refuses to re-apply a rolled-back import", async () => {
    const table = await parseImportFile("p.csv", csv(`${HEADERS}\nStore #1052,STORE-1052,1200 Main St,Dallas,TX,75201,1998\n`));
    const job = await newJob("PROPERTIES", MAPPING);
    await commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "SKIP" } });
    await rollbackImport({ ctx: ctxFor(), jobId: job.id });
    await expect(
      commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "SKIP" } }),
    ).rejects.toThrow(/rolled back/);
  });
});

describe("assets (§67 onboarding: properties, then assets)", () => {
  it("links assets to properties by customer property ID", async () => {
    await prisma.property.create({
      data: {
        organizationId: org.id,
        portfolioId,
        name: "Store #1052",
        customerPropertyId: "STORE-1052",
        addressLine1: "1200 Main St",
        city: "Dallas",
        state: "TX",
        postalCode: "75201",
      },
    });

    const table = await parseImportFile(
      "a.csv",
      csv("Property,Asset Name,Asset Type,Asset Tag,Criticality\nSTORE-1052,RTU-04,HVAC,TAG-4,4\n"),
    );
    const job = await newJob("ASSETS", {
      Property: "propertyRef",
      "Asset Name": "name",
      "Asset Type": "assetType",
      "Asset Tag": "customerAssetId",
      Criticality: "criticalityScore",
    });
    const result = await commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "SKIP" } });

    expect(result.created).toBe(1);
    const asset = await prisma.asset.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(asset).toMatchObject({ name: "RTU-04", assetType: "HVAC", criticalityScore: 4 });
  });

  it("fails clearly when an asset names a property that does not exist", async () => {
    const table = await parseImportFile("a.csv", csv("Property,Asset Name,Asset Type\nSTORE-9999,RTU-04,HVAC\n"));
    const job = await newJob("ASSETS", { Property: "propertyRef", "Asset Name": "name", "Asset Type": "assetType" });
    await expect(
      commitImport({ ctx: ctxFor(), jobId: job.id, table, options: { duplicateStrategy: "SKIP" } }),
    ).rejects.toThrow(/Import properties before their assets/);
  });
});
