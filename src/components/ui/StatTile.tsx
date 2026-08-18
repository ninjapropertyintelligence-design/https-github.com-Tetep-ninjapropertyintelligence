import Link from "next/link";
import { ReactNode } from "react";

/**
 * Clickable KPI tile — spec §5 "every dashboard number must be actionable."
 * Pass `href` to make it a deep link into the filtered list that produced
 * the number (e.g. 17 Critical Properties -> /properties?healthBand=Critical).
 */
export function StatTile({
  label,
  value,
  href,
  tone = "default",
  sublabel,
}: {
  label: string;
  value: ReactNode;
  href?: string;
  tone?: "default" | "critical" | "warning" | "good";
  sublabel?: string;
}) {
  const toneClass =
    tone === "critical"
      ? "text-[var(--band-critical)]"
      : tone === "warning"
        ? "text-[var(--band-needs-attention)]"
        : tone === "good"
          ? "text-[var(--band-good)]"
          : "text-foreground";

  const content = (
    <div className="rounded-xl border border-border bg-surface px-5 py-4 shadow-sm transition hover:shadow-md hover:border-brand/40 h-full">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1.5 text-3xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {sublabel ? <p className="mt-1 text-xs text-muted">{sublabel}</p> : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {content}
      </Link>
    );
  }
  return content;
}
