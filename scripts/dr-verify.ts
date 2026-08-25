/**
 * Disaster-recovery verification (spec §55 "Test: Database restoration,
 * File restoration, Queue recovery, Vendor outage behavior").
 *
 * This is not a document describing a restore — it performs one. It takes a
 * backup, restores it into a scratch database, and checks the four things
 * the spec names, then drops the scratch database. The measured restore
 * duration is the empirical input to the RTO claim in
 * docs/DISASTER_RECOVERY.md; a target nobody has timed is a guess.
 *
 * Run: npm run dr:verify
 * Exits non-zero if any check fails, so it can gate a pipeline.
 */
import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { collectRowCounts, collectStorageKeys, libpqUrl } from "./backup";

const exec = promisify(execFile);
const LOCAL_STORAGE_ROOT = path.join(process.cwd(), ".local-storage");

type CheckStatus = "PASS" | "FAIL" | "INCONCLUSIVE";

interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

/**
 * INCONCLUSIVE exists because a check that runs against an empty table
 * cannot tell "restored correctly" from "there was nothing to restore".
 * Reporting that as PASS would be claiming coverage this run did not have.
 */
const checks: Check[] = [];
function record(name: string, status: CheckStatus, detail: string) {
  checks.push({ name, status, detail });
  console.log(`${status.padEnd(12)} ${name}\n             ${detail}`);
}

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function main() {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL is not set");

  const scratchName = `dr_verify_${Date.now()}`;
  const scratchUrl = withDatabase(sourceUrl, scratchName);
  // CREATE DATABASE cannot run inside the database being dumped's session
  // in every configuration; the `postgres` maintenance database always can.
  const maintenanceUrl = libpqUrl(withDatabase(sourceUrl, "postgres"));
  const workDir = await mkdtemp(path.join(tmpdir(), "dr-verify-"));
  const dumpFile = path.join(workDir, "backup.dump");

  const source = new PrismaClient({ adapter: new PrismaPg({ connectionString: sourceUrl }) });
  let scratch: PrismaClient | null = null;

  try {
    console.log("Capturing source state...");
    const expectedRowCounts = await collectRowCounts(source);
    const expectedStorageKeys = await collectStorageKeys(source);
    // "Queue recovery" in this system means the processing-job table: jobs
    // are rows with a status, not messages in a broker. Recovering the queue
    // therefore means those rows surviving with their state intact.
    const expectedJobs = await source.droneProcessingJob.findMany({
      select: { id: true, status: true, datasetId: true },
      orderBy: { id: "asc" },
    });

    console.log("Taking backup...");
    const backupStarted = Date.now();
    await exec("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", dumpFile, libpqUrl(sourceUrl)]);
    const backupMs = Date.now() - backupStarted;

    console.log(`Restoring into scratch database ${scratchName}...`);
    const restoreStarted = Date.now();
    // `createdb` with no arguments falls back to the OS user and the local
    // socket, which is not where this database lives. Going through psql
    // against the maintenance database uses the same credentials as the app.
    await exec("psql", [maintenanceUrl, "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE "${scratchName}"`]);
    // pg_restore reports non-fatal notices on stderr and can exit non-zero
    // for them; --exit-on-error makes a genuine failure fail loudly instead.
    await exec("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--dbname", libpqUrl(scratchUrl), dumpFile]);
    const restoreMs = Date.now() - restoreStarted;

    scratch = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl }) });

    // --- 1. Database restoration ---------------------------------------
    const restoredRowCounts = await collectRowCounts(scratch);
    const mismatched = Object.entries(expectedRowCounts).filter(
      ([table, count]) => restoredRowCounts[table] !== count,
    );
    record(
      "Database restoration — row counts match across every checked table",
      mismatched.length === 0 ? "PASS" : "FAIL",
      mismatched.length === 0
        ? `${Object.keys(expectedRowCounts).length} tables, ${Object.values(expectedRowCounts).reduce((a, b) => a + b, 0)} rows; restored in ${restoreMs}ms (backup took ${backupMs}ms)`
        : `mismatched: ${mismatched.map(([t, c]) => `${t} expected ${c} got ${restoredRowCounts[t]}`).join(", ")}`,
    );

    // Migration history has to survive, or the restored database can't be
    // migrated forward and is a dead end.
    const migrations = await scratch.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    record(
      "Database restoration — migration history restored",
      Number(migrations[0].count) > 0 ? "PASS" : "FAIL",
      `${migrations[0].count} applied migrations present in the restored database`,
    );

    // Referential integrity: a restore that drops constraints looks fine
    // until the first write. Confirm the FKs came back.
    const fks = await scratch.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM pg_constraint WHERE contype = 'f'`,
    );
    record(
      "Database restoration — foreign key constraints intact",
      Number(fks[0].count) > 0 ? "PASS" : "FAIL",
      `${fks[0].count} foreign key constraints present`,
    );

    // --- 2. File restoration -------------------------------------------
    // Every object the restored database references must actually exist in
    // storage. This is the check that catches a database-only backup: rows
    // restore perfectly and every photo 404s.
    const restoredKeys = Object.values(await collectStorageKeys(scratch)).flat();
    const expectedKeyCount = Object.values(expectedStorageKeys).flat().length;
    const missing: string[] = [];
    for (const key of restoredKeys) {
      try {
        await access(path.join(LOCAL_STORAGE_ROOT, key));
      } catch {
        missing.push(key);
      }
    }
    record(
      "File restoration — every referenced object exists in storage",
      missing.length > 0 ? "FAIL" : restoredKeys.length === 0 ? "INCONCLUSIVE" : "PASS",
      missing.length > 0
        ? `${missing.length} of ${restoredKeys.length} objects missing, e.g. ${missing.slice(0, 3).join(", ")}`
        : restoredKeys.length === 0
          ? "The database references no stored objects, so this run proves nothing about file restoration. Seed or use a database with evidence/documents to exercise it."
          : `${restoredKeys.length} referenced objects, all present (source referenced ${expectedKeyCount})`,
    );

    // --- 3. Queue recovery ---------------------------------------------
    const restoredJobs = await scratch.droneProcessingJob.findMany({
      select: { id: true, status: true, datasetId: true },
      orderBy: { id: "asc" },
    });
    const jobsMatch =
      restoredJobs.length === expectedJobs.length &&
      restoredJobs.every((job, i) => job.id === expectedJobs[i].id && job.status === expectedJobs[i].status);
    // DroneCaptureStatus values, not invented ones: a job that was mid-flight
    // when the failure hit is UPLOADING or PROCESSING, and those are what
    // have to be re-driven after a restore. (This filter originally named
    // QUEUED/RUNNING, which are not members of the enum, so it silently
    // always reported zero.)
    const resumable = restoredJobs.filter((j) => j.status === "UPLOADING" || j.status === "PROCESSING");
    record(
      "Queue recovery — processing jobs restored with their state",
      !jobsMatch ? "FAIL" : expectedJobs.length === 0 ? "INCONCLUSIVE" : "PASS",
      expectedJobs.length === 0
        ? "No processing jobs existed in the source, so this run proves nothing about queue recovery. " +
          "Jobs are database rows rather than broker messages, so restoring the database is what restores the queue — " +
          "but that needs a non-empty queue to demonstrate."
        : `${restoredJobs.length} jobs restored with matching status; ${resumable.length} in a resumable state.`,
    );

    // --- 4. Vendor outage behavior -------------------------------------
    // Every external provider must degrade to an explicit not-configured
    // state rather than throwing, which is what a vendor outage looks like
    // from inside the app.
    const vendorResults = await checkVendorDegradation();
    record(
      "Vendor outage behavior — every provider fails in the way callers handle",
      vendorResults.every((r) => r.ok) ? "PASS" : "FAIL",
      vendorResults.map((r) => `${r.name}: ${r.detail}`).join("; "),
    );

    console.log("\n--- Measured (feeds the RTO target in docs/DISASTER_RECOVERY.md) ---");
    console.log(`Backup:  ${backupMs}ms`);
    console.log(`Restore: ${restoreMs}ms`);
  } finally {
    await source.$disconnect();
    await scratch?.$disconnect();
    // Best effort: a leaked scratch database is noise, not a failure.
    await exec("psql", [maintenanceUrl, "-c", `DROP DATABASE IF EXISTS "${scratchName}"`]).catch(() => {});
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  const failed = checks.filter((c) => c.status === "FAIL");
  const inconclusive = checks.filter((c) => c.status === "INCONCLUSIVE");
  console.log(
    `\n${checks.filter((c) => c.status === "PASS").length}/${checks.length} checks passed` +
      (inconclusive.length ? `, ${inconclusive.length} inconclusive (nothing to test against)` : "") +
      (failed.length ? `, ${failed.length} FAILED` : ""),
  );
  if (failed.length) process.exit(1);
}

/**
 * Instantiates each provider with no credentials — the state an outage or a
 * revoked key leaves the app in — and confirms it reports itself
 * unconfigured instead of throwing.
 */
async function checkVendorDegradation(): Promise<Array<{ name: string; ok: boolean; detail: string }>> {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];

  const { MatterportProvider } = await import("../src/lib/integrations/matterport-provider");
  const { ManualUploadPhotogrammetryProvider } = await import(
    "../src/lib/integrations/manual-photogrammetry-provider"
  );
  const { MapboxGeocodingProvider } = await import("../src/lib/integrations/mapbox-geocoding-provider");
  const { NullProvider } = await import("../src/lib/ai/providers/null-provider");
  const { AIProviderNotConfiguredError } = await import("../src/lib/ai/provider");
  type AIProvider = import("../src/lib/ai/provider").AIProvider;

  try {
    const mp = new MatterportProvider(undefined, undefined, undefined);
    results.push({
      name: "Matterport",
      ok: mp.isConfigured() === false && mp.isViewerConfigured() === false,
      detail: "reports not configured",
    });
  } catch (err) {
    results.push({ name: "Matterport", ok: false, detail: `threw: ${(err as Error).message}` });
  }

  try {
    const geo = new MapboxGeocodingProvider(undefined);
    results.push({ name: "Mapbox", ok: geo.isConfigured() === false, detail: "reports not configured" });
  } catch (err) {
    results.push({ name: "Mapbox", ok: false, detail: `threw: ${(err as Error).message}` });
  }

  // The AI fallback deliberately throws rather than answering — inventing an
  // answer during an outage would be worse than failing. What matters is
  // that it throws a *typed* error callers already handle, not an arbitrary
  // one that would surface as a 500.
  try {
    // Typed as the interface: NullProvider narrows generateResponse to zero
    // parameters, and calling it as a caller would is the point of the check.
    const ai: AIProvider = new NullProvider("none");
    await ai.generateResponse({ system: "", prompt: "dr check" });
    results.push({ name: "AI", ok: false, detail: "answered despite being unconfigured — it must not fabricate" });
  } catch (err) {
    const typed = err instanceof AIProviderNotConfiguredError;
    results.push({
      name: "AI",
      ok: typed,
      detail: typed ? "throws AIProviderNotConfiguredError, which callers handle" : `threw untyped: ${(err as Error).message}`,
    });
  }

  try {
    const photo = new ManualUploadPhotogrammetryProvider();
    results.push({ name: "Photogrammetry", ok: photo.name.length > 0, detail: "manual fallback available" });
  } catch (err) {
    results.push({ name: "Photogrammetry", ok: false, detail: `threw: ${(err as Error).message}` });
  }

  return results;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
