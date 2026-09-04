import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { SessionContext } from "@/lib/tenant-scope";
import { Prisma } from "@/generated/prisma/client";
import { ImportEntity, fieldMap, fieldsFor, missingRequiredFields, suggestMapping } from "@/lib/import/fields";
import { ParsedTable } from "@/lib/import/parse";
import { parseExternalIdCell } from "@/lib/import/normalize";
import {
  DedupCandidate,
  DedupSubject,
  DedupVerdict,
  findIntraFileDuplicates,
  findMatches,
  indexCandidates,
  verdictFor,
} from "@/lib/import/dedup";

/**
 * Import orchestration (spec §68). The pipeline is deliberately
 * preview-then-commit:
 *
 *   parse -> map -> validate -> dedup -> PREVIEW -> commit -> (rollback)
 *
 * Nothing is written until the user has seen the preview, because every
 * requirement in §68 other than "field mapping" exists to answer the
 * question "what is about to happen to my data?" before it happens.
 */

export interface RowIssue {
  rowNumber: number;
  column: string | null;
  field: string | null;
  message: string;
  value?: string;
}

export interface PreviewRow {
  rowNumber: number;
  values: Record<string, string | number | null>;
  verdict: DedupVerdict | "ERROR";
  issues: RowIssue[];
  /** Existing record this row matched, when it did. */
  match?: { id: string; name: string; rule: string; confidence: number; detail: string };
  /** Set when an earlier row in the SAME file already claimed this identity. */
  duplicateOfRow?: number;
}

export interface ImportPreview {
  entity: ImportEntity;
  headers: string[];
  mapping: Record<string, string>;
  unmappedHeaders: string[];
  missingRequired: string[];
  sheetName?: string;
  ignoredSheets?: string[];
  totals: { rows: number; ok: number; duplicates: number; needsReview: number; errors: number; skippedEmptyRows: number };
  rows: PreviewRow[];
  issues: RowIssue[];
}

/** Preview payloads are capped; the counts above always cover the whole file. */
const MAX_PREVIEW_ROWS = 200;

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export async function buildPreview(params: {
  ctx: SessionContext;
  entity: ImportEntity;
  table: ParsedTable;
  mapping?: Record<string, string>;
}): Promise<ImportPreview> {
  const { ctx, entity, table } = params;
  const mapping = params.mapping ?? suggestMapping(table.headers, entity);
  const fields = fieldMap(entity);

  const missingRequired = missingRequiredFields(mapping, entity).map((f) => f.label);
  const unmappedHeaders = table.headers.filter((h) => !mapping[h]);

  // Coerce + validate every row first, so counts cover the whole file even
  // though only the first MAX_PREVIEW_ROWS are returned in detail.
  const coerced: Array<{ values: Record<string, string | number | null>; issues: RowIssue[] }> = [];

  table.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const values: Record<string, string | number | null> = {};
    const issues: RowIssue[] = [];

    table.headers.forEach((header, columnIndex) => {
      const fieldKey = mapping[header];
      if (!fieldKey) return;
      const field = fields.get(fieldKey);
      if (!field) return;

      const raw = row[columnIndex] ?? "";
      const result = field.coerce(raw);
      if (!result.ok) {
        issues.push({ rowNumber, column: header, field: fieldKey, message: result.error ?? "Invalid value", value: raw });
        return;
      }
      values[fieldKey] = result.value ?? null;
    });

    // A required field with no column mapped at all still has to fail per
    // row, or a file missing a column would silently import blank values.
    for (const field of fieldsFor(entity)) {
      if (!field.required) continue;
      const value = values[field.key];
      if (value === undefined || value === null || value === "") {
        if (!issues.some((i) => i.field === field.key)) {
          issues.push({ rowNumber, column: null, field: field.key, message: `${field.label} is required` });
        }
      }
    }

    coerced.push({ values, issues });
  });

  // Reference columns are resolved during preview too, so an unknown
  // portfolio/region shows up as a row issue the user can fix before
  // committing, rather than as a mid-commit failure.
  if (entity === "PROPERTIES") {
    const [portfolioByName, regionByName] = await Promise.all([loadPortfolioIndex(ctx), loadRegionIndex(ctx)]);
    coerced.forEach(({ values, issues }, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const portfolioName = typeof values.portfolio === "string" ? values.portfolio : "";
      if (portfolioName && !portfolioByName.has(portfolioName.trim().toLowerCase())) {
        issues.push({ rowNumber, column: null, field: "portfolio", message: `No portfolio named "${portfolioName}"`, value: portfolioName });
      }
      const regionName = typeof values.region === "string" ? values.region : "";
      if (regionName && !regionByName.has(regionName.trim().toLowerCase())) {
        issues.push({ rowNumber, column: null, field: "region", message: `No region named "${regionName}"`, value: regionName });
      }
    });
  }

  const subjects = coerced.map(({ values }) => toDedupSubject(entity, values));
  const intraFile = findIntraFileDuplicates(subjects);
  const index = indexCandidates(await loadDedupCandidates(ctx, entity));

  const rows: PreviewRow[] = [];
  const allIssues: RowIssue[] = [];
  let ok = 0;
  let duplicates = 0;
  let needsReview = 0;
  let errors = 0;

  coerced.forEach(({ values, issues }, rowIndex) => {
    const rowNumber = rowIndex + 1;
    allIssues.push(...issues);

    let verdict: PreviewRow["verdict"];
    let match: PreviewRow["match"];
    const duplicateOfRow = intraFile.get(rowIndex);

    if (issues.length > 0) {
      verdict = "ERROR";
      errors++;
    } else if (duplicateOfRow !== undefined) {
      verdict = "DUPLICATE";
      duplicates++;
    } else {
      const matches = findMatches(subjects[rowIndex], index);
      const best = matches[0] ?? null;
      verdict = verdictFor(best);
      if (best) {
        match = {
          id: best.candidateId,
          name: best.candidateName,
          rule: best.best.rule,
          confidence: best.best.confidence,
          detail: best.best.detail,
        };
      }
      if (verdict === "DUPLICATE") duplicates++;
      else if (verdict === "NEEDS_REVIEW") needsReview++;
      else ok++;
    }

    if (rows.length < MAX_PREVIEW_ROWS) {
      rows.push({
        rowNumber,
        values,
        verdict,
        issues,
        match,
        duplicateOfRow: duplicateOfRow === undefined ? undefined : duplicateOfRow + 1,
      });
    }
  });

  return {
    entity,
    headers: table.headers,
    mapping,
    unmappedHeaders,
    missingRequired,
    sheetName: table.sheetName,
    ignoredSheets: table.otherSheetNames?.length ? table.otherSheetNames : undefined,
    totals: {
      rows: table.rows.length,
      ok,
      duplicates,
      needsReview,
      errors,
      skippedEmptyRows: table.skippedEmptyRows,
    },
    rows,
    issues: allIssues,
  };
}

function toDedupSubject(entity: ImportEntity, values: Record<string, string | number | null>): DedupSubject {
  const str = (key: string) => (typeof values[key] === "string" ? (values[key] as string) : "");
  if (entity === "ASSETS") {
    // Assets are deduped within their property, keyed on the customer asset
    // id or the name; the property reference is folded into the name key so
    // "RTU-04" at two different stores stays two assets.
    return {
      name: `${str("propertyRef")}|${str("name")}`,
      customerPropertyId: str("customerAssetId") || null,
      externalIds: parseExternalIdCell(str("externalIds")),
    };
  }
  return {
    name: str("name"),
    customerPropertyId: str("customerPropertyId") || null,
    externalIds: parseExternalIdCell(str("externalIds")),
    addressLine1: str("addressLine1"),
    city: str("city"),
    state: str("state"),
    postalCode: str("postalCode"),
  };
}

async function loadDedupCandidates(ctx: SessionContext, entity: ImportEntity): Promise<DedupCandidate[]> {
  if (entity === "ASSETS") {
    const assets = await prisma.asset.findMany({
      where: { organizationId: ctx.organizationId },
      select: {
        id: true,
        name: true,
        customerAssetId: true,
        externalIds: true,
        property: { select: { name: true, customerPropertyId: true } },
      },
    });
    return assets.map((a) => ({
      id: a.id,
      name: `${a.property.customerPropertyId ?? a.property.name}|${a.name}`,
      customerPropertyId: a.customerAssetId,
      externalIds: a.externalIds,
      addressLine1: "",
      city: "",
      state: "",
      postalCode: "",
    }));
  }

  const properties = await prisma.property.findMany({
    where: { organizationId: ctx.organizationId },
    select: {
      id: true,
      name: true,
      customerPropertyId: true,
      externalIds: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
    },
  });
  return properties;
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export interface CommitOptions {
  /** What to do with rows that matched an existing record (spec §69). */
  duplicateStrategy: "SKIP" | "UPDATE";
  /** Portfolio for property rows that don't name their own. */
  targetPortfolioId?: string | null;
}

export interface CommitResult {
  importJobId: string;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

/**
 * Applies the import in a single transaction (spec §68 "Rollback"): either
 * every row lands or none does, so a failure halfway through cannot leave a
 * half-imported portfolio behind. Per-row outcomes and before-images are
 * recorded inside the same transaction, which is what makes the *later*
 * undo possible too.
 */
export async function commitImport(params: {
  ctx: SessionContext;
  jobId: string;
  table: ParsedTable;
  options: CommitOptions;
}): Promise<CommitResult> {
  const { ctx, jobId, table, options } = params;

  const job = await prisma.importJob.findFirst({ where: { id: jobId, organizationId: ctx.organizationId } });
  if (!job) throw new ApiError(404, "Import job not found");
  if (job.status === "COMPLETED") throw new ApiError(409, "This import has already been applied");
  if (job.status === "ROLLED_BACK") throw new ApiError(409, "This import was rolled back and cannot be re-applied");

  const entity = job.entityType as ImportEntity;
  const preview = await buildPreview({
    ctx,
    entity,
    table,
    mapping: job.columnMapping as Record<string, string>,
  });

  if (preview.missingRequired.length > 0) {
    throw new ApiError(400, `Map a column to these required fields first: ${preview.missingRequired.join(", ")}`);
  }

  const portfolioId = options.targetPortfolioId ?? job.targetPortfolioId ?? null;
  if (entity === "PROPERTIES" && !portfolioId) {
    throw new ApiError(400, "Choose a portfolio for the imported properties");
  }
  if (portfolioId) {
    const portfolio = await prisma.portfolio.findFirst({
      where: { id: portfolioId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!portfolio) throw new ApiError(404, "Portfolio not found");
  }

  // Re-run coercion over the whole file: the preview caps its detailed rows,
  // and the commit must cover every one of them.
  const fields = fieldMap(entity);
  const mapping = preview.mapping;

  const rowsToApply: Array<{ rowNumber: number; values: Record<string, string | number | null>; verdict: DedupVerdict | "ERROR"; matchId?: string }> = [];

  const subjects: DedupSubject[] = [];
  const coercedAll: Array<{ values: Record<string, string | number | null>; hasError: boolean }> = [];

  table.rows.forEach((row) => {
    const values: Record<string, string | number | null> = {};
    let hasError = false;
    table.headers.forEach((header, columnIndex) => {
      const fieldKey = mapping[header];
      if (!fieldKey) return;
      const field = fields.get(fieldKey);
      if (!field) return;
      const result = field.coerce(row[columnIndex] ?? "");
      if (!result.ok) hasError = true;
      else values[fieldKey] = result.value ?? null;
    });
    for (const field of fieldsFor(entity)) {
      if (field.required) {
        const value = values[field.key];
        if (value === undefined || value === null || value === "") hasError = true;
      }
    }
    coercedAll.push({ values, hasError });
    subjects.push(toDedupSubject(entity, values));
  });

  const intraFile = findIntraFileDuplicates(subjects);
  const index = indexCandidates(await loadDedupCandidates(ctx, entity));

  coercedAll.forEach(({ values, hasError }, rowIndex) => {
    const rowNumber = rowIndex + 1;
    if (hasError) {
      rowsToApply.push({ rowNumber, values, verdict: "ERROR" });
      return;
    }
    if (intraFile.has(rowIndex)) {
      rowsToApply.push({ rowNumber, values, verdict: "DUPLICATE" });
      return;
    }
    const best = findMatches(subjects[rowIndex], index)[0] ?? null;
    rowsToApply.push({ rowNumber, values, verdict: verdictFor(best), matchId: best?.candidateId });
  });

  const portfolioByName = await loadPortfolioIndex(ctx);
  const regionByName = await loadRegionIndex(ctx);
  const propertyRefIndex = entity === "ASSETS" ? await loadPropertyRefIndex(ctx) : new Map<string, string>();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  await prisma.$transaction(
    async (tx) => {
      await tx.importRowResult.deleteMany({ where: { importJobId: jobId } });

      for (const row of rowsToApply) {
        if (row.verdict === "ERROR") {
          errors++;
          await tx.importRowResult.create({
            data: { importJobId: jobId, rowNumber: row.rowNumber, action: "SKIPPED_ERROR", message: "Row had validation errors" },
          });
          continue;
        }

        // NEEDS_REVIEW is treated as a duplicate for safety: a row the
        // matcher was unsure about must never silently create a second
        // property. The reviewer resolves it and re-imports.
        const isDuplicate = row.verdict === "DUPLICATE" || row.verdict === "NEEDS_REVIEW";

        if (isDuplicate && (options.duplicateStrategy === "SKIP" || !row.matchId)) {
          skipped++;
          await tx.importRowResult.create({
            data: {
              importJobId: jobId,
              rowNumber: row.rowNumber,
              action: "SKIPPED_DUPLICATE",
              entityId: row.matchId ?? null,
              message: row.matchId ? "Matched an existing record" : "Duplicate of an earlier row in this file",
            },
          });
          continue;
        }

        if (isDuplicate && row.matchId) {
          const before = await captureBeforeImage(tx, entity, row.matchId, row.values);
          await applyUpdate(tx, entity, row.matchId, row.values, ctx);
          updated++;
          await tx.importRowResult.create({
            data: { importJobId: jobId, rowNumber: row.rowNumber, action: "UPDATED", entityId: row.matchId, beforeImage: before as Prisma.InputJsonValue },
          });
          continue;
        }

        const entityId = await applyCreate(tx, entity, row.values, {
          ctx,
          portfolioId,
          portfolioByName,
          regionByName,
          propertyRefIndex,
        });
        created++;
        await tx.importRowResult.create({
          data: { importJobId: jobId, rowNumber: row.rowNumber, action: "CREATED", entityId },
        });
      }

      await tx.importJob.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          rowCount: rowsToApply.length,
          successCount: created + updated,
          duplicateCount: skipped,
          errorCount: errors,
          targetPortfolioId: portfolioId,
          completedAt: new Date(),
        },
      });
    },
    // A 5,000-row import does real work per row; the default 5s cap would
    // abort a legitimate import partway.
    { timeout: 120_000, maxWait: 10_000 },
  );

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "import.completed",
    entityType: "ImportJob",
    entityId: jobId,
    metadata: { entity, created, updated, skipped, errors, duplicateStrategy: options.duplicateStrategy },
  });

  return { importJobId: jobId, created, updated, skipped, errors };
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

/**
 * Undoes a completed import (spec §68 "Rollback"): created records are
 * deleted, updated records get their previous values back from the stored
 * before-image. Only the fields the import actually changed are restored,
 * so an edit made after the import to some other field survives the undo.
 */
export async function rollbackImport(params: { ctx: SessionContext; jobId: string }): Promise<{ deleted: number; restored: number }> {
  const { ctx, jobId } = params;
  const job = await prisma.importJob.findFirst({ where: { id: jobId, organizationId: ctx.organizationId } });
  if (!job) throw new ApiError(404, "Import job not found");
  if (job.status !== "COMPLETED") throw new ApiError(409, `Only a completed import can be rolled back (this one is ${job.status})`);

  const entity = job.entityType as ImportEntity;
  const results = await prisma.importRowResult.findMany({
    where: { importJobId: jobId, action: { in: ["CREATED", "UPDATED"] } },
  });

  let deleted = 0;
  let restored = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const result of results) {
        if (!result.entityId) continue;

        if (result.action === "CREATED") {
          // deleteMany, not delete: a record the customer already removed
          // themselves must not fail the whole rollback.
          const removed =
            entity === "PROPERTIES"
              ? await tx.property.deleteMany({ where: { id: result.entityId, organizationId: ctx.organizationId } })
              : await tx.asset.deleteMany({ where: { id: result.entityId, organizationId: ctx.organizationId } });
          deleted += removed.count;
        } else if (result.beforeImage && typeof result.beforeImage === "object") {
          const before = result.beforeImage as Record<string, unknown>;
          if (entity === "PROPERTIES") {
            await tx.property.updateMany({ where: { id: result.entityId, organizationId: ctx.organizationId }, data: before as Prisma.PropertyUpdateManyMutationInput });
          } else {
            await tx.asset.updateMany({ where: { id: result.entityId, organizationId: ctx.organizationId }, data: before as Prisma.AssetUpdateManyMutationInput });
          }
          restored++;
        }
      }

      await tx.importJob.update({ where: { id: jobId }, data: { status: "ROLLED_BACK", undoneAt: new Date() } });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "import.rolled_back",
    entityType: "ImportJob",
    entityId: jobId,
    metadata: { entity, deleted, restored },
  });

  return { deleted, restored };
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

/** Only the fields this row will actually change, so an undo is surgical. */
async function captureBeforeImage(
  tx: Tx,
  entity: ImportEntity,
  id: string,
  values: Record<string, string | number | null>,
): Promise<Record<string, unknown>> {
  const columns = writableColumns(entity, values);
  if (columns.length === 0) return {};

  const record =
    entity === "PROPERTIES"
      ? await tx.property.findUnique({ where: { id } })
      : await tx.asset.findUnique({ where: { id } });
  if (!record) return {};

  const before: Record<string, unknown> = {};
  for (const column of columns) {
    const value = (record as Record<string, unknown>)[column];
    before[column] = value instanceof Date ? value.toISOString() : value;
  }
  return before;
}

function writableColumns(entity: ImportEntity, values: Record<string, string | number | null>): string[] {
  const skip = new Set(["portfolio", "region", "externalIds", "propertyRef"]);
  return Object.keys(values).filter((key) => !skip.has(key) && values[key] !== undefined && values[key] !== "");
}

async function applyUpdate(
  tx: Tx,
  entity: ImportEntity,
  id: string,
  values: Record<string, string | number | null>,
  ctx: SessionContext,
) {
  const data: Record<string, unknown> = {};
  for (const column of writableColumns(entity, values)) {
    data[column] = normalizeForColumn(column, values[column]);
  }
  if (Object.keys(data).length === 0) return;
  data.updatedBy = ctx.userId;

  if (entity === "PROPERTIES") {
    await tx.property.updateMany({ where: { id, organizationId: ctx.organizationId }, data: data as Prisma.PropertyUpdateManyMutationInput });
  } else {
    await tx.asset.updateMany({ where: { id, organizationId: ctx.organizationId }, data: data as Prisma.AssetUpdateManyMutationInput });
  }
}

async function applyCreate(
  tx: Tx,
  entity: ImportEntity,
  values: Record<string, string | number | null>,
  deps: {
    ctx: SessionContext;
    portfolioId: string | null;
    portfolioByName: Map<string, string>;
    regionByName: Map<string, string>;
    propertyRefIndex: Map<string, string>;
  },
): Promise<string> {
  const { ctx } = deps;
  const str = (key: string) => (typeof values[key] === "string" ? (values[key] as string) : "");
  const num = (key: string) => (typeof values[key] === "number" ? (values[key] as number) : null);
  const externalIds = parseExternalIdCell(str("externalIds"));

  if (entity === "PROPERTIES") {
    // A row that NAMES a portfolio must resolve to that portfolio or fail.
    // Falling back to the import's default here would silently file a
    // property into the wrong portfolio on a typo — a misplacement nobody
    // would notice until they went looking for it.
    let portfolioId: string | null;
    if (str("portfolio")) {
      portfolioId = deps.portfolioByName.get(normalizeKey(str("portfolio"))) ?? null;
      if (!portfolioId) {
        throw new ApiError(400, `Row references portfolio "${str("portfolio")}", which does not exist in this organization`);
      }
    } else {
      portfolioId = deps.portfolioId;
    }
    if (!portfolioId) {
      throw new ApiError(400, "Choose a portfolio for the imported properties");
    }

    // Same rule for region: a named region that doesn't resolve is an
    // error, not a silently dropped assignment.
    let regionId: string | null = null;
    if (str("region")) {
      regionId = deps.regionByName.get(normalizeKey(str("region"))) ?? null;
      if (!regionId) {
        throw new ApiError(400, `Row references region "${str("region")}", which does not exist in this organization`);
      }
    }

    const created = await tx.property.create({
      data: {
        organizationId: ctx.organizationId,
        portfolioId,
        regionId,
        name: str("name"),
        customerPropertyId: str("customerPropertyId") || null,
        externalIds: externalIds as unknown as Prisma.InputJsonValue,
        addressLine1: str("addressLine1"),
        addressLine2: str("addressLine2") || null,
        city: str("city"),
        state: str("state"),
        postalCode: str("postalCode"),
        country: str("country") || "US",
        latitude: num("latitude"),
        longitude: num("longitude"),
        propertyType: str("propertyType") || "Retail",
        squareFootage: num("squareFootage"),
        yearBuilt: num("yearBuilt"),
        updatedBy: ctx.userId,
      },
      select: { id: true },
    });
    return created.id;
  }

  const propertyId = deps.propertyRefIndex.get(normalizeKey(str("propertyRef")));
  if (!propertyId) {
    throw new ApiError(400, `No property matches "${str("propertyRef")}". Import properties before their assets.`);
  }

  const installedAt = str("installedAt") ? new Date(`${str("installedAt")}T00:00:00.000Z`) : null;
  const created = await tx.asset.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId,
      name: str("name"),
      assetType: str("assetType"),
      customerAssetId: str("customerAssetId") || null,
      externalIds: externalIds as unknown as Prisma.InputJsonValue,
      manufacturer: str("manufacturer") || null,
      model: str("model") || null,
      serialNumber: str("serialNumber") || null,
      installedAt,
      expectedUsefulLifeYears: num("expectedUsefulLifeYears"),
      conditionScore: num("conditionScore"),
      criticalityScore: num("criticalityScore") ?? 3,
      replacementCost: num("replacementCost"),
      updatedBy: ctx.userId,
    },
    select: { id: true },
  });
  return created.id;
}

function normalizeForColumn(column: string, value: string | number | null | undefined) {
  if (column === "installedAt" && typeof value === "string" && value !== "") {
    return new Date(`${value}T00:00:00.000Z`);
  }
  return value ?? null;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

async function loadPortfolioIndex(ctx: SessionContext): Promise<Map<string, string>> {
  const portfolios = await prisma.portfolio.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, name: true },
  });
  return new Map(portfolios.map((p) => [normalizeKey(p.name), p.id]));
}

async function loadRegionIndex(ctx: SessionContext): Promise<Map<string, string>> {
  const regions = await prisma.region.findMany({
    where: { portfolio: { organizationId: ctx.organizationId } },
    select: { id: true, name: true },
  });
  return new Map(regions.map((r) => [normalizeKey(r.name), r.id]));
}

/** Assets reference their property by customer ID first, then by name. */
async function loadPropertyRefIndex(ctx: SessionContext): Promise<Map<string, string>> {
  const properties = await prisma.property.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, name: true, customerPropertyId: true },
  });
  const index = new Map<string, string>();
  for (const property of properties) {
    index.set(normalizeKey(property.name), property.id);
  }
  // Customer IDs are set last so they win over a name collision.
  for (const property of properties) {
    if (property.customerPropertyId) index.set(normalizeKey(property.customerPropertyId), property.id);
  }
  return index;
}
