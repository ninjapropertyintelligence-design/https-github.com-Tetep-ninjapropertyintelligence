"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { ImpersonationInfo } from "@/lib/session-context";

/**
 * The "visible indicator" spec §45 requires. Deliberately loud and fixed to
 * the top of every page: a support person must never be able to forget they
 * are looking at a customer's data, and a screenshot taken during a session
 * must show it.
 */
export function ImpersonationBanner({
  info,
  organizationName,
}: {
  info: ImpersonationInfo;
  organizationName: string;
}) {
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  const [remaining, setRemaining] = useState(() => msRemaining(info.expiresAt));

  useEffect(() => {
    const id = setInterval(() => {
      const next = msRemaining(info.expiresAt);
      setRemaining(next);
      // The server stops honouring the session on expiry; refresh so the UI
      // stops claiming otherwise instead of showing a stale banner.
      if (next <= 0) router.refresh();
    }, 1000);
    return () => clearInterval(id);
  }, [info.expiresAt, router]);

  async function end() {
    setEnding(true);
    try {
      await apiFetch("/api/v1/admin/impersonation/end", { method: "POST" });
      router.push("/admin");
      router.refresh();
    } finally {
      setEnding(false);
    }
  }

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 bg-[var(--band-critical)] px-4 py-2 text-sm text-white"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold">Support session — viewing {organizationName}</span>
        <span className="opacity-90">Reason: {info.reason}</span>
        <span className="opacity-90">Read-only</span>
        <span className="tabular-nums opacity-90">Ends in {formatRemaining(remaining)}</span>
      </div>
      <button
        onClick={end}
        disabled={ending}
        className="rounded-md bg-white/20 px-3 py-1 font-medium hover:bg-white/30 disabled:opacity-50"
      >
        {ending ? "Ending..." : "End session"}
      </button>
    </div>
  );
}

function msRemaining(expiresAt: Date | string): number {
  return new Date(expiresAt).getTime() - Date.now();
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
