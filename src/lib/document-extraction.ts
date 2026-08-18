import { prisma } from "@/lib/prisma";
import { getStorageProvider } from "@/lib/storage";
import { Prisma } from "@/generated/prisma/client";
import { logEvent } from "@/lib/observability";

/**
 * Document intelligence foundation (spec Phase 2 §15). Text extraction +
 * chunking + keyword full-text search — no vector infrastructure is
 * configured in this environment, so this implements real Postgres
 * full-text search rather than faking semantic search.
 */

const CHUNK_SIZE = 1500; // characters
const CHUNK_OVERLAP = 200;

const EXTRACTABLE_MIME_TYPES = new Set(["application/pdf"]);

function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    const end = Math.min(start + CHUNK_SIZE, trimmed.length);
    chunks.push(trimmed.slice(start, end));
    if (end === trimmed.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * Extracts text from the latest version of a Document and (re)builds its
 * DocumentChunk rows. Safe to call multiple times (e.g. after a new
 * version uploads) — replaces existing chunks for the document.
 */
export async function extractAndIndexDocument(documentId: string): Promise<void> {
  const startedAt = Date.now();
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  if (!document) return;

  const latestVersion = document.versions[0];
  if (!latestVersion) {
    await prisma.document.update({ where: { id: documentId }, data: { indexStatus: "FAILED", indexError: "No file version to extract" } });
    logEvent("document.index_job", { ok: false, organizationId: document.organizationId, durationMs: Date.now() - startedAt, errorMessage: "No file version to extract" });
    return;
  }

  if (!EXTRACTABLE_MIME_TYPES.has(latestVersion.mimeType)) {
    await prisma.document.update({
      where: { id: documentId },
      data: { indexStatus: "UNSUPPORTED", indexError: `Text extraction not implemented for MIME type "${latestVersion.mimeType}"` },
    });
    return;
  }

  try {
    const bytes = await getStorageProvider().readBytes(latestVersion.storageKey);
    if (!bytes) throw new Error("File not found in storage");

    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    let pages;
    try {
      pages = (await parser.getText()).pages;
    } finally {
      await parser.destroy();
    }

    await prisma.$transaction([
      prisma.documentChunk.deleteMany({ where: { documentId } }),
      ...pages.flatMap((page) =>
        chunkText(page.text).map((content, idx) =>
          prisma.documentChunk.create({
            data: {
              organizationId: document.organizationId,
              documentId,
              propertyId: document.propertyId,
              assetId: document.assetId,
              chunkIndex: idx,
              pageNumber: page.num,
              content,
            },
          }),
        ),
      ),
      prisma.document.update({ where: { id: documentId }, data: { indexStatus: "INDEXED", indexError: null, indexedAt: new Date() } }),
    ]);
    logEvent("document.index_job", { ok: true, organizationId: document.organizationId, durationMs: Date.now() - startedAt });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown extraction error";
    await prisma.document.update({
      where: { id: documentId },
      data: { indexStatus: "FAILED", indexError: errorMessage },
    });
    logEvent("document.index_job", { ok: false, organizationId: document.organizationId, durationMs: Date.now() - startedAt, errorMessage });
  }
}

export interface DocumentSearchHit {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  pageNumber: number | null;
  snippet: string;
  propertyId: string | null;
  assetId: string | null;
}

/**
 * Tenant-scoped keyword full-text search over indexed document chunks
 * (Postgres `to_tsquery`/`plainto_tsquery` — real full-text search, not a
 * substring scan and not a fake vector search).
 */
export async function searchDocumentChunks(params: {
  organizationId: string;
  query: string;
  propertyId?: string;
  assetId?: string;
  limit?: number;
}): Promise<DocumentSearchHit[]> {
  const limit = params.limit ?? 20;
  const propertyFilter = params.propertyId ? Prisma.sql`AND dc."propertyId" = ${params.propertyId}` : Prisma.empty;
  const assetFilter = params.assetId ? Prisma.sql`AND dc."assetId" = ${params.assetId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      documentId: string;
      documentTitle: string;
      chunkId: string;
      pageNumber: number | null;
      content: string;
      propertyId: string | null;
      assetId: string | null;
      rank: number;
    }>
  >(Prisma.sql`
    SELECT
      dc."documentId" AS "documentId",
      d."title" AS "documentTitle",
      dc."id" AS "chunkId",
      dc."pageNumber" AS "pageNumber",
      dc."content" AS "content",
      dc."propertyId" AS "propertyId",
      dc."assetId" AS "assetId",
      ts_rank(to_tsvector('english', dc."content"), plainto_tsquery('english', ${params.query})) AS rank
    FROM "DocumentChunk" dc
    JOIN "Document" d ON d."id" = dc."documentId"
    WHERE dc."organizationId" = ${params.organizationId}
      ${propertyFilter}
      ${assetFilter}
      AND to_tsvector('english', dc."content") @@ plainto_tsquery('english', ${params.query})
    ORDER BY rank DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    chunkId: r.chunkId,
    pageNumber: r.pageNumber,
    snippet: r.content.length > 300 ? r.content.slice(0, 300) + "…" : r.content,
    propertyId: r.propertyId,
    assetId: r.assetId,
  }));
}
