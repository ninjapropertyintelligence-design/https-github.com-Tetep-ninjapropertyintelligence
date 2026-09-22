/**
 * Applies pending Prisma migrations during a Vercel build, but ONLY when
 * explicitly opted in.
 *
 * Why this exists: the environment this repo is developed in cannot open a
 * TCP connection to the database (its egress allows HTTPS only), so
 * `prisma migrate deploy` cannot be run from a developer session against a
 * hosted Postgres. The build environment can reach it, so that is where
 * migrations run.
 *
 * Why it is opt-in rather than unconditional: a migration step that runs on
 * every build runs on every PREVIEW build too, each of which would migrate
 * whatever database its environment variables happen to point at. Requiring
 * RUN_MIGRATIONS=1 means schema changes are applied deliberately, by someone
 * who set that variable, and never as a side effect of pushing a branch.
 *
 * Two separate URLs on purpose: migrations use MIGRATION_DATABASE_URL, which
 * must be a SESSION-mode connection (port 5432). Prisma takes a Postgres
 * advisory lock for the duration of a migration, and transaction-mode
 * pooling (port 6543) hands out a different backend per statement, so the
 * lock cannot be held. The app's own DATABASE_URL stays on the pooler.
 */
import { execFileSync } from "node:child_process";

const migrateOptedIn = process.env.RUN_MIGRATIONS === "1";
const seedOptedIn = process.env.RUN_SEED === "1";
const url = process.env.MIGRATION_DATABASE_URL;

// Each flag is read independently. An earlier version exited the whole
// script when RUN_MIGRATIONS was not 1, which silently made seeding
// REQUIRE migrating — the opposite of what the comment below promises, and
// invisible because the build still went green. RUN_SEED=1 with
// RUN_MIGRATIONS=0 simply logged nothing and seeded nothing.
if (!migrateOptedIn && !seedOptedIn) {
  console.log("[migrate-on-build] RUN_MIGRATIONS and RUN_SEED are both unset — nothing to do.");
  process.exit(0);
}

if (!url) {
  // Opted in but unusable: fail loudly rather than build an app whose schema
  // silently does not match its code.
  console.error(
    "[migrate-on-build] RUN_MIGRATIONS or RUN_SEED is 1 but MIGRATION_DATABASE_URL is not set.",
  );
  process.exit(1);
}

if (migrateOptedIn) {
  console.log("[migrate-on-build] Applying migrations (session-mode connection)...");
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      stdio: "inherit",
      // Prisma reads DATABASE_URL; point it at the session-mode URL for the
      // duration of this one command without disturbing the runtime value.
      env: { ...process.env, DATABASE_URL: url },
    });
    console.log("[migrate-on-build] Migrations applied.");
  } catch {
    // Never mask a migration failure — a green build on an unmigrated database
    // is the worst possible outcome.
    console.error("[migrate-on-build] Migration failed; failing the build.");
    process.exit(1);
  }
} else {
  console.log("[migrate-on-build] RUN_MIGRATIONS is not 1 — skipping migrations.");
}

/**
 * Seeding is a SEPARATE opt-in from migrating.
 *
 * Migrations are additive and safe to re-run; the seed writes demo
 * organizations, users and properties, which is not something anyone should
 * be able to trigger by pushing a branch. Requiring its own flag means demo
 * data lands only when someone deliberately asked for it.
 *
 * The seed itself is idempotent (it upserts), so a build that runs twice does
 * not produce two demo organizations.
 */
if (seedOptedIn) {
  console.log("[migrate-on-build] RUN_SEED=1 — seeding demo data...");
  try {
    execFileSync("npx", ["tsx", "prisma/seed.ts"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url },
    });
    console.log("[migrate-on-build] Seed complete.");
  } catch {
    console.error("[migrate-on-build] Seed failed; failing the build.");
    process.exit(1);
  }
} else {
  console.log("[migrate-on-build] RUN_SEED is not 1 — not seeding.");
}
