import { NavIconKey } from "@/lib/nav-shared";

/**
 * Inline stroke icons on a 24x24 grid. Inline rather than an icon package:
 * the set is small and fixed, and a dependency for seventeen paths is not
 * worth the bundle or the upgrade surface.
 *
 * `PATHS` is deliberately a partial record — an icon key with no drawing
 * renders the fallback dot instead of throwing, so adding a nav item never
 * breaks the shell.
 */
const PATHS: Partial<Record<NavIconKey, React.ReactNode>> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  map: (
    <>
      <path d="M9 4L3 6.5v13L9 17l6 3 6-2.5v-13L15 7 9 4z" strokeLinejoin="round" />
      <path d="M9 4v13M15 7v13" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V6a2 2 0 012-2h7a2 2 0 012 2v15" strokeLinejoin="round" />
      <path d="M15 11h3a2 2 0 012 2v8" strokeLinejoin="round" />
      <path d="M2 21h20M8 8h3M8 12h3M8 16h3" strokeLinecap="round" />
    </>
  ),
  asset: (
    <>
      <path d="M12 2.5l8 4.5v9l-8 4.5-8-4.5v-9l8-4.5z" strokeLinejoin="round" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" strokeLinejoin="round" />
    </>
  ),
  issue: (
    <>
      <path d="M12 3.5l9 16H3l9-16z" strokeLinejoin="round" />
      <path d="M12 10v4M12 17h.01" strokeLinecap="round" />
    </>
  ),
  assessment: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8.5 11.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  import: (
    <>
      <path d="M12 3v11" strokeLinecap="round" />
      <path d="M8 10l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" />
    </>
  ),
  report: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 16v-3M12 16v-6M16 16v-4" strokeLinecap="round" />
    </>
  ),
  cost: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M14.5 9.5c0-1.1-1.1-1.8-2.5-1.8s-2.5.7-2.5 1.8 1.1 1.6 2.5 1.9 2.5.8 2.5 1.9-1.1 1.8-2.5 1.8-2.5-.7-2.5-1.8" strokeLinecap="round" />
    </>
  ),
  ai: (
    <>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" strokeLinejoin="round" />
      <path d="M18 15.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3z" strokeLinejoin="round" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5v.2a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1h.2a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" strokeLinejoin="round" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5.5c0 4.3-2.9 8.2-7 9.5-4.1-1.3-7-5.2-7-9.5V6l7-3z" strokeLinejoin="round" />
      <path d="M9.5 12l1.8 1.8 3.4-3.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  webhook: (
    <>
      <circle cx="6.5" cy="17.5" r="3" />
      <circle cx="17.5" cy="17.5" r="3" />
      <circle cx="12" cy="5.5" r="3" />
      <path d="M10.5 8l-3 6.8M13.5 8l3 6.8M9.5 17.5h5" strokeLinecap="round" />
    </>
  ),
  retention: (
    <>
      <path d="M4 6h16" strokeLinecap="round" />
      <path d="M6 6l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13" strokeLinejoin="round" />
      <path d="M9.5 6V4h5v2M10 10.5v6M14 10.5v6" strokeLinecap="round" />
    </>
  ),
  storage: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" strokeLinejoin="round" />
      <path d="M20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3" />
    </>
  ),
  usage: (
    <>
      <path d="M3 17l5-6 4 3.5L21 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 11V6h-5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  platform: (
    <>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 7h.01M7 17h.01" strokeLinecap="round" />
    </>
  ),
};

export function NavIcon({ icon, className = "h-[18px] w-[18px]" }: { icon: NavIconKey; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      {PATHS[icon] ?? <circle cx="12" cy="12" r="3.5" />}
    </svg>
  );
}
