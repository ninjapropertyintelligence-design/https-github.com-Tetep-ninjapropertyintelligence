"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { MfaManager } from "@/components/security/MfaManager";
import type { MfaStatus } from "@/lib/mfa-service";

/**
 * Rendered *instead of* the app when the organization requires MFA and the
 * signed-in user has not enrolled. Blocking by replacing the page rather
 * than redirecting avoids the redirect loop a path-based guard invites, and
 * needs no knowledge of the current route.
 *
 * This is a UX gate on top of a real one: `withApiHandler` refuses the same
 * user's API calls independently, so bypassing this component gains nothing.
 */
export function MfaRequiredGate({ status, orgName }: { status: MfaStatus; orgName: string }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-background px-4 py-16">
      <div className="w-full max-w-2xl space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Two-factor authentication is required</h1>
          <p className="mt-1 text-sm text-muted">
            {orgName} requires every member to use a second factor. Set it up to continue.
          </p>
        </div>
        <MfaManager status={status} />
        <Button variant="ghost" onClick={() => signOut({ callbackUrl: "/login" })}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
