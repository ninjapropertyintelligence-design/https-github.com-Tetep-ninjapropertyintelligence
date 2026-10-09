import Link from "next/link";
import type { ReactNode } from "react";

/** The frame shared by the signed-out pages: sign in, forgot and reset password. */
export function AuthCard({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Property Intelligence Platform</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">{children}</div>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-muted hover:text-foreground">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export const authInputClass =
  "mt-1 mb-4 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand";

/** Reads this API's `{ error: string }` envelope; falls back to the status line. */
export async function errorFrom(res: Response): Promise<string> {
  const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`;
}
