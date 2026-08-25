/**
 * Backup (spec §55). Produces the two artifacts a restore actually needs:
 *
 *   1. A `pg_dump` custom-format archive of the database.
 *   2. A manifest of every object-storage key the database references.
 *
 * The manifest is what makes file restoration verifiable. A database dump
 * on its own restores rows that point at objects, with no way to tell
 * whether those objects still exist — which is how a restore appears to
 * succeed and then serves 404s for every photo and document.
 *
 * Run: npm run dr:backup [-- --out ./backups]
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const exec = promisify(execFile);

/**
 * Prisma connection strings carry `?schema=public`, which libpq rejects as
 * an unknown URI parameter — so `pg_dump`/`pg_restore` need it stripped.
 * Every other query parameter (sslmode, connect_timeout) is kept.
 */
export function libpqUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("schema");
  parsed.searchParams.delete("connection_limit");
  parsed.searchParams.delete("pool_timeout");
  return parsed.toString();
}


export interface BackupManifest {
  createdAt: string;
  databaseName: string;
  dumpFile: string;
  /** Every object-storage key reachable from the database, by source table. */
  storageKeys: Record<string, string[]>;
  totalStorageKeys: number;
  rowCounts: Record<string, number>;
}

/** Row counts per table, the cheapest meaningful integrity check on restore. */
export async function collectRowCounts(prisma: PrismaClient): Promise<Record<string, number>> {
  const [organizations, users, properties, assets, issues, assessments, evidence, documents, documentVersions, documentChunks, droneImages, droneOutputs, droneProcessingJobs, auditLogs] =
    await Promise.all([
      prisma.organization.count(),
      prisma.user.count(),
      prisma.property.count(),
      prisma.asset.count(),
      prisma.issue.count(),
      prisma.assessment.count(),
      prisma.evidence.count(),
      prisma.document.count(),
      prisma.documentVersion.count(),
      prisma.documentChunk.count(),
      prisma.droneImage.count(),
      prisma.droneOutput.count(),
      prisma.droneProcessingJob.count(),
      prisma.auditLog.count(),
    ]);

  return {
    Organization: organizations,
    User: users,
    Property: properties,
    Asset: assets,
    Issue: issues,
    Assessment: assessments,
    Evidence: evidence,
    Document: documents,
    DocumentVersion: documentVersions,
    DocumentChunk: documentChunks,
    DroneImage: droneImages,
    DroneOutput: droneOutputs,
    DroneProcessingJob: droneProcessingJobs,
    AuditLog: auditLogs,
  };
}

export async function collectStorageKeys(prisma: PrismaClient): Promise<Record<string, string[]>> {
  const [evidence, documentVersions, droneImages, droneOutputs] = await Promise.all([
    prisma.evidence.findMany({ select: { storageKey: true, thumbnailKey: true } }),
    prisma.documentVersion.findMany({ select: { storageKey: true, thumbnailKey: true } }),
    prisma.droneImage.findMany({ select: { storageKey: true, thumbnailKey: true } }),
    prisma.droneOutput.findMany({ select: { storageKey: true } }),
  ]);

  const nonNull = (keys: Array<string | null>) => keys.filter((k): k is string => Boolean(k));

  return {
    Evidence: nonNull([...evidence.map((e) => e.storageKey), ...evidence.map((e) => e.thumbnailKey)]),
    DocumentVersion: nonNull([
      ...documentVersions.map((d) => d.storageKey),
      ...documentVersions.map((d) => d.thumbnailKey),
    ]),
    DroneImage: nonNull([...droneImages.map((i) => i.storageKey), ...droneImages.map((i) => i.thumbnailKey)]),
    DroneOutput: nonNull(droneOutputs.map((o) => o.storageKey)),
  };
}

async function main() {
  const outDir = argValue("--out") ?? path.join(process.cwd(), "backups");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpFile = path.join(outDir, `backup-${stamp}.dump`);

  const started = Date.now();
  // Custom format (-Fc): compressed, and restorable selectively, which
  // matters when only one table needs recovering.
  await exec("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", dumpFile, libpqUrl(databaseUrl)]);
  const dumpMs = Date.now() - started;

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const storageKeys = await collectStorageKeys(prisma);
    const manifest: BackupManifest = {
      createdAt: new Date().toISOString(),
      databaseName: new URL(databaseUrl).pathname.slice(1),
      dumpFile: path.basename(dumpFile),
      storageKeys,
      totalStorageKeys: Object.values(storageKeys).flat().length,
      rowCounts: await collectRowCounts(prisma),
    };
    const manifestFile = dumpFile.replace(/\.dump$/, ".manifest.json");
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));

    console.log(`Database dump:  ${dumpFile} (${dumpMs}ms)`);
    console.log(`Manifest:       ${manifestFile}`);
    console.log(`Storage keys:   ${manifest.totalStorageKeys}`);
  } finally {
    await prisma.$disconnect();
  }
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

// Only run when invoked directly, so the helpers above can be imported by
// the verification script and by tests.
if (process.argv[1]?.includes("backup")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
