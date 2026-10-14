/**
 * Measures the hot read paths at two portfolio sizes and reports how each one
 * SCALES (spec §98/§103).
 *
 * WHY SCALING AND NOT LATENCY. These numbers come from a development
 * container sharing a CPU with a Postgres that has no production tuning, no
 * connection pooler in front of it, and a cold cache. The absolute
 * milliseconds are worth very little — quoting them as "the platform responds
 * in Xms" would be a fabrication dressed as evidence.
 *
 * What does transfer is the SHAPE of the curve. If a query takes ~10x longer
 * for 10x the data it is linear and will behave predictably as a customer
 * grows; if it takes ~100x longer it is quadratic and will fall over at a
 * portfolio size nobody tested. That ratio is a property of the query, not of
 * the machine, so it is the thing this script reports and asserts on.
 *
 * Usage: tsx scripts/perf-benchmark.ts [--small 200] [--large 2000]
 */
import { prisma } from "@/lib/prisma";
import { seedPerfDataset } from "./perf-seed";
import { getPortfolioDashboard } from "@/lib/dashboard";
import { getLatestHealthSnapshots } from "@/lib/scoring";
import { findPropertiesWithinRadius } from "@/lib/spatial";
import { summarizePropertyCogs } from "@/lib/cost-metering";
import { Role } from "@/generated/prisma/client";
import type { SessionContext } from "@/lib/tenant-scope";

interface Measurement {
  name: string;
  medianMs: number;
  /** Worst observed run, which is what a user actually notices. */
  maxMs: number;
  rows?: number;
}

/** Median of several runs: one sample on a shared machine is mostly noise. */
async function measure(name: string, runs: number, fn: () => Promise<unknown>): Promise<Measurement> {
  await fn(); // Warm caches and plans, so the first run's cost is not reported as typical.
  const times: number[] = [];
  let rows: number | undefined;
  for (let i = 0; i < runs; i += 1) {
    const started = process.hrtime.bigint();
    const result = await fn();
    times.push(Number(process.hrtime.bigint() - started) / 1e6);
    if (Array.isArray(result)) rows = result.length;
  }
  times.sort((a, b) => a - b);
  return {
    name,
    medianMs: times[Math.floor(times.length / 2)],
    maxMs: times[times.length - 1],
    rows,
  };
}

function ctxFor(organizationId: string, userId: string): SessionContext {
  return {
    userId,
    userName: "Perf",
    userEmail: "perf-harness@example.com",
    isPlatformAdmin: false,
    organizationId,
    organizationName: "Perf Harness Org",
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

async function runSuite(propertyCount: number, reset: boolean): Promise<Measurement[]> {
  const { organizationId, userId } = await seedPerfDataset(propertyCount, reset);
  const ctx = ctxFor(organizationId, userId);

  const propertyIds = (
    await prisma.property.findMany({ where: { organizationId }, select: { id: true } })
  ).map((p) => p.id);

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  return [
    await measure("portfolio dashboard", 5, () => getPortfolioDashboard(ctx)),
    await measure("latest health snapshots (DISTINCT ON)", 5, () =>
      getLatestHealthSnapshots(propertyIds),
    ),
    await measure("property list (scoped, paged 50)", 5, () =>
      prisma.property.findMany({ where: { organizationId }, take: 50, orderBy: { name: "asc" } }),
    ),
    await measure("spatial radius search (100 mi)", 5, () =>
      findPropertiesWithinRadius(ctx, {
        latitude: 32.7767,
        longitude: -96.797,
        radiusMeters: 160_934,
      }).then((r) => r.properties),
    ),
    await measure("property COGS report (30d)", 3, () =>
      summarizePropertyCogs(organizationId, periodStart, periodEnd),
    ),
  ];
}

function classify(ratio: number, dataRatio: number): string {
  // Linear means "grew about as fast as the data". Sub-linear is better
  // (an index is doing work); super-linear is the warning sign.
  if (ratio < dataRatio * 0.5) return "sub-linear";
  if (ratio <= dataRatio * 1.6) return "~linear";
  if (ratio <= dataRatio * 3) return "super-linear";
  return "QUADRATIC-ish";
}

async function main() {
  const arg = (flag: string, fallback: number) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? fallback : Number(process.argv[i + 1]);
  };
  const small = arg("--small", 200);
  const large = arg("--large", 2000);
  const dataRatio = large / small;

  console.log(`\n=== Scale ${small} properties ===`);
  const a = await runSuite(small, true);
  console.log(`\n=== Scale ${large} properties ===`);
  const b = await runSuite(large, true);

  console.log(`\n${"=".repeat(96)}`);
  console.log(`SCALING REPORT — ${small} -> ${large} properties (${dataRatio}x the data)`);
  console.log("Absolute times are from a dev container and are NOT production figures.");
  console.log("The ratio column is the finding.");
  console.log("=".repeat(96));
  console.log(
    "path".padEnd(42) +
      `${small}p`.padStart(10) +
      `${large}p`.padStart(10) +
      "ratio".padStart(10) +
      "  verdict",
  );
  console.log("-".repeat(96));

  const regressions: string[] = [];
  for (const [i, measurement] of a.entries()) {
    const at = measurement.medianMs;
    const bt = b[i].medianMs;
    const ratio = at === 0 ? 0 : bt / at;
    const verdict = classify(ratio, dataRatio);
    if (verdict === "super-linear" || verdict === "QUADRATIC-ish") {
      regressions.push(`${measurement.name}: ${ratio.toFixed(1)}x for ${dataRatio}x data`);
    }
    console.log(
      measurement.name.padEnd(42) +
        `${at.toFixed(1)}ms`.padStart(10) +
        `${bt.toFixed(1)}ms`.padStart(10) +
        `${ratio.toFixed(1)}x`.padStart(10) +
        `  ${verdict}`,
    );
  }
  console.log("=".repeat(96));

  if (regressions.length > 0) {
    console.log("\nPaths growing faster than their data:");
    for (const r of regressions) console.log(`  - ${r}`);
  } else {
    console.log("\nEvery measured path grew at most linearly with the data.");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
