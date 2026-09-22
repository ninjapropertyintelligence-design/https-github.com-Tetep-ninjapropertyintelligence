import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { installBigIntJson } from "@/lib/json-safe";

// Installed here because this module is imported by every path that can
// produce a BigInt — they come out of Prisma — so the guard cannot be
// bypassed by a route that forgets it.
installBigIntJson();

// Standard Next.js dev-mode singleton to avoid exhausting DB connections
// across hot reloads. Uses the Prisma 7 driver-adapter API (node-postgres).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. The app cannot reach its database — set it in the environment.",
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/**
 * CONSTRUCTED LAZILY, ON FIRST USE — not when this module is imported.
 *
 * `next build` evaluates every route module while collecting page data. When
 * the client was built at import time, a missing DATABASE_URL threw during
 * that pass and failed the whole build:
 *
 *   Failed to collect configuration for /api/v1/reports/capital-exposure
 *   [cause]: Error: DATABASE_URL is not set
 *
 * That is the wrong place to fail. The build does not need a database — every
 * route in this app is dynamic and nothing is prerendered — so coupling
 * compilation to runtime configuration only means a missing variable takes
 * down the build instead of surfacing as a clear error on the first request.
 * It also hid the real problem behind a generic build failure, which is how
 * three deployments failed before the cause was identified.
 *
 * The Proxy defers construction to the first property access. Behaviour at
 * runtime is unchanged: the same singleton, the same error text, just raised
 * when something actually tries to query.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = (globalForPrisma.prisma ??= createPrismaClient());
    // In production the global is a plain memo; the dev-reload singleton
    // behaviour it exists for is unchanged.
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, property) {
    return property in (globalForPrisma.prisma ??= createPrismaClient());
  },
});
