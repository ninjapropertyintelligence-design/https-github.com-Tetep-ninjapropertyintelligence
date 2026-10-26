import { Role } from "@/generated/prisma/client";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * The platform team acting inside the organization of `ctx` — what
 * `platformActingContext` produces for a real platform admin. Capture jobs are
 * ordered and approved by the platform team, not by the customer.
 */
export function asPlatform(ctx: SessionContext): SessionContext {
  return { ...ctx, role: Role.PLATFORM_ADMIN, isPlatformAdmin: true, vendorId: null, grants: [], impersonation: null };
}
