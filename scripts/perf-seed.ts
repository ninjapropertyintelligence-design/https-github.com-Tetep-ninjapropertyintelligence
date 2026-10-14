/**
 * Generates a synthetic portfolio at a chosen scale, for performance work
 * (spec §98/§103).
 *
 * The implementation report has carried this gap for several phases: the
 * scoring engine's `getLatestHealthSnapshots()` uses a DISTINCT ON query
 * "designed for portfolio scale", but it had never been run against
 * 1,000+/10,000+ properties. A design intended for scale that has never met
 * scale is an assumption, not a property.
 *
 * Deterministic on purpose. A fixed seed means two runs at the same scale
 * produce identical data, so a timing difference between them is a code
 * change rather than a different dataset. Comparing runs is the entire point.
 *
 * Usage:
 *   tsx scripts/perf-seed.ts --properties 1000
 *   tsx scripts/perf-seed.ts --properties 10000 --reset
 */
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";

/** Deterministic PRNG (mulberry32) — no dependency, same sequence every run. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PERF_ORG_SLUG = "perf-harness-org";

const ASSETS_PER_PROPERTY = 10;
const ISSUES_PER_PROPERTY = 6;
/**
 * Several snapshots per property, because the DISTINCT ON query exists to pick
 * the newest of many. One row per property would make it look free.
 */
const SNAPSHOTS_PER_PROPERTY = 5;

/** Postgres caps bind parameters per statement; batch well under it. */
const BATCH = 1_000;

async function insertInBatches<T>(
  label: string,
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await insert(rows.slice(i, i + BATCH));
    if (i % (BATCH * 10) === 0 && i > 0) {
      process.stdout.write(`  ${label}: ${i}/${rows.length}\r`);
    }
  }
  console.log(`  ${label}: ${rows.length} rows`.padEnd(48));
}

export async function seedPerfDataset(propertyCount: number, reset = false) {
  const random = rng(20260922);

  if (reset) {
    const existing = await prisma.organization.findUnique({ where: { slug: PERF_ORG_SLUG } });
    if (existing) {
      console.log("Removing the previous perf dataset...");
      // Cascades through the graph from the organization down.
      await prisma.organization.delete({ where: { id: existing.id } });
    }
  }

  const org = await prisma.organization.upsert({
    where: { slug: PERF_ORG_SLUG },
    update: {},
    create: { name: "Perf Harness Org", slug: PERF_ORG_SLUG },
  });

  const user = await prisma.user.upsert({
    where: { email: "perf-harness@example.com" },
    update: {},
    create: { email: "perf-harness@example.com", passwordHash: "x", name: "Perf Harness" },
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: {},
    create: { userId: user.id, organizationId: org.id, role: Role.OWNER },
  });

  const portfolio = await prisma.portfolio.create({
    data: { organizationId: org.id, name: `Portfolio ${Date.now()}` },
  });

  console.log(`Seeding ${propertyCount} properties...`);

  // Spread across the continental US so spatial queries have real dispersion
  // rather than every point landing on top of every other one.
  const properties = Array.from({ length: propertyCount }, (_, i) => ({
    id: `perf-p-${i}`,
    organizationId: org.id,
    portfolioId: portfolio.id,
    name: `Perf Property ${i}`,
    addressLine1: `${100 + i} Test Street`,
    city: "Testville",
    state: "TX",
    postalCode: "75001",
    latitude: 25 + random() * 24,
    longitude: -124 + random() * 57,
    updatedAt: new Date(),
  }));
  await insertInBatches("properties", properties, (chunk) =>
    prisma.property.createMany({ data: chunk, skipDuplicates: true }),
  );

  const assets = properties.flatMap((p, pi) =>
    Array.from({ length: ASSETS_PER_PROPERTY }, (_, ai) => ({
      id: `perf-a-${pi}-${ai}`,
      organizationId: org.id,
      propertyId: p.id,
      name: `Asset ${ai}`,
      assetType: ["HVAC", "Roof", "Electrical", "Plumbing"][ai % 4],
      criticalityScore: 1 + Math.floor(random() * 5),
      updatedAt: new Date(),
    })),
  );
  await insertInBatches("assets", assets, (chunk) =>
    prisma.asset.createMany({ data: chunk, skipDuplicates: true }),
  );

  const issues = properties.flatMap((p, pi) =>
    Array.from({ length: ISSUES_PER_PROPERTY }, (_, ii) => ({
      id: `perf-i-${pi}-${ii}`,
      organizationId: org.id,
      propertyId: p.id,
      title: `Issue ${ii}`,
      severity: (["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const)[ii % 4],
      status: (["OPEN", "TRIAGED", "ASSIGNED", "RESOLVED"] as const)[ii % 4],
      createdById: user.id,
      updatedAt: new Date(),
    })),
  );
  await insertInBatches("issues", issues, (chunk) =>
    prisma.issue.createMany({ data: chunk, skipDuplicates: true }),
  );

  const snapshots = properties.flatMap((p, pi) =>
    Array.from({ length: SNAPSHOTS_PER_PROPERTY }, (_, si) => ({
      id: `perf-s-${pi}-${si}`,
      propertyId: p.id,
      healthScore: 40 + random() * 60,
      riskScore: random() * 100,
      dataConfidenceScore: 50 + random() * 50,
      categoryBreakdown: {},
      capitalExposure12mo: Math.floor(random() * 500_000),
      capitalExposure24mo: Math.floor(random() * 900_000),
      capitalExposure36mo: Math.floor(random() * 1_500_000),
      // Distinct timestamps so "newest per property" is a real choice.
      computedAt: new Date(Date.now() - si * 86_400_000),
    })),
  );
  await insertInBatches("health snapshots", snapshots, (chunk) =>
    prisma.propertyHealthSnapshot.createMany({ data: chunk, skipDuplicates: true }),
  );

  console.log(
    `\nSeeded: ${properties.length} properties, ${assets.length} assets, ` +
      `${issues.length} issues, ${snapshots.length} snapshots.`,
  );
  return { organizationId: org.id, userId: user.id, propertyCount };
}

const isDirectRun = process.argv[1]?.includes("perf-seed");
if (isDirectRun) {
  const arg = (flag: string) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const count = Number(arg("--properties") ?? 1000);
  const reset = process.argv.includes("--reset");
  seedPerfDataset(count, reset)
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
