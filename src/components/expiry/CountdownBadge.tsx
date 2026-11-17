import { countdownLabel, urgencyFor, type Urgency } from "@/lib/expiry-rules";

const STYLES: Record<Urgency, string> = {
  expired: "bg-[color-mix(in_srgb,var(--band-critical)_16%,white)] text-[var(--band-critical)]",
  urgent: "bg-[color-mix(in_srgb,var(--band-poor)_16%,white)] text-[var(--band-poor)]",
  soon: "bg-[color-mix(in_srgb,var(--band-needs-attention)_16%,white)] text-[var(--band-needs-attention)]",
  ok: "bg-zinc-100 text-zinc-600",
};

/** How long until something expires, coloured by how soon. */
export function CountdownBadge({ daysLeft }: { daysLeft: number }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[urgencyFor(daysLeft)]}`}>
      {countdownLabel(daysLeft)}
    </span>
  );
}
