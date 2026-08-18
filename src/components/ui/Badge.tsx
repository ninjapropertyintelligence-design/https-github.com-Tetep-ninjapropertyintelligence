import { ReactNode } from "react";

const BAND_STYLES: Record<string, string> = {
  Excellent: "bg-[color-mix(in_srgb,var(--band-excellent)_14%,white)] text-[var(--band-excellent)]",
  Good: "bg-[color-mix(in_srgb,var(--band-good)_14%,white)] text-[var(--band-good)]",
  "Needs Attention": "bg-[color-mix(in_srgb,var(--band-needs-attention)_16%,white)] text-[var(--band-needs-attention)]",
  Poor: "bg-[color-mix(in_srgb,var(--band-poor)_16%,white)] text-[var(--band-poor)]",
  Critical: "bg-[color-mix(in_srgb,var(--band-critical)_16%,white)] text-[var(--band-critical)]",
};

const SEVERITY_STYLES: Record<string, string> = {
  LOW: "bg-zinc-100 text-zinc-600",
  MEDIUM: "bg-[color-mix(in_srgb,var(--severity-medium)_16%,white)] text-[var(--severity-medium)]",
  HIGH: "bg-[color-mix(in_srgb,var(--severity-high)_16%,white)] text-[var(--severity-high)]",
  CRITICAL: "bg-[color-mix(in_srgb,var(--severity-critical)_16%,white)] text-[var(--severity-critical)]",
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-zinc-100 text-zinc-700",
  TRIAGED: "bg-blue-50 text-blue-700",
  ASSIGNED: "bg-blue-50 text-blue-700",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  RESOLVED: "bg-green-50 text-green-700",
  VERIFIED: "bg-green-50 text-green-700",
  CLOSED: "bg-zinc-100 text-zinc-500",
  ACTIVE: "bg-green-50 text-green-700",
  DRAFT: "bg-zinc-100 text-zinc-600",
  COMPLETED: "bg-green-50 text-green-700",
};

export function HealthBandBadge({ band }: { band: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BAND_STYLES[band] ?? "bg-zinc-100 text-zinc-600"}`}>
      {band}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${SEVERITY_STYLES[severity] ?? "bg-zinc-100 text-zinc-600"}`}>
      {severity}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? "bg-zinc-100 text-zinc-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        tone === "brand" ? "bg-brand/10 text-brand" : "bg-zinc-100 text-zinc-600"
      }`}
    >
      {children}
    </span>
  );
}
