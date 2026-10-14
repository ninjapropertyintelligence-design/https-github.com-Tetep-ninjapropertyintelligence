"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { NavItem, groupNavItems } from "@/lib/nav-shared";
import { NavIcon } from "@/components/layout/NavIcon";

const STORAGE_KEY = "nav:collapsed";

/**
 * The collapse preference lives in localStorage, which the server cannot see.
 * Reading it during render would hydrate mismatched markup; reading it in an
 * effect and calling setState would render once, then immediately again.
 * `useSyncExternalStore` is the shape React provides for exactly this: a
 * server snapshot for the first paint, a client snapshot after hydration.
 */
let listeners: Array<() => void> = [];
let cached: boolean | null = null;

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private mode or blocked storage — expanded is a fine default.
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.push(onChange);
  return () => {
    listeners = listeners.filter((l) => l !== onChange);
  };
}

function getSnapshot(): boolean {
  if (cached === null) cached = readStored();
  return cached;
}

/** The server has no preference to read, so it always renders expanded. */
function getServerSnapshot(): boolean {
  return false;
}

function setCollapsed(next: boolean): void {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Persisting is a convenience; failing to must not break the nav.
  }
  for (const l of listeners) l();
}

/**
 * Two initials for the org tile — the slot a customer logo would occupy.
 * Falls back to one character, then to a dash, so a single-word or empty
 * org name still renders a tile rather than an empty box.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function Sidebar({ items, orgName, roleLabel }: { items: NavItem[]; orgName: string; roleLabel: string }) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const groups = groupNavItems(items);

  return (
    <aside
      className={`relative hidden shrink-0 flex-col bg-shell text-shell-foreground transition-[width] duration-200 md:flex ${
        collapsed ? "w-[68px]" : "w-60"
      }`}
    >
      <div className={`flex items-center gap-3 border-b border-white/10 px-4 py-4 ${collapsed ? "justify-center px-0" : ""}`}>
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[13px] font-semibold tracking-wide text-white"
        >
          {initialsOf(orgName)}
        </span>
        {collapsed ? null : (
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">{orgName}</span>
            <span className="block truncate text-xs text-shell-muted">{roleLabel}</span>
          </span>
        )}
      </div>

      {/* Sits on the sidebar's edge, the way the reference does, so the control
          is where the boundary is rather than buried inside the panel. */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        aria-expanded={!collapsed}
        className="absolute -right-3 top-[68px] z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-md transition hover:text-foreground"
      >
        <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 transition-transform ${collapsed ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((group) => (
          <div key={group.section} className="mb-4 last:mb-0">
            {collapsed ? (
              <div className="mx-3 mb-2 border-t border-white/10 first:border-0" />
            ) : (
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-shell-muted">{group.section}</p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      collapsed ? "justify-center px-0" : ""
                    } ${active ? "bg-white/15 text-white" : "text-shell-foreground hover:bg-white/10 hover:text-white"}`}
                  >
                    <NavIcon icon={item.icon} />
                    {/* Always rendered so the link's accessible name — and any
                        test or screen reader that looks it up — is the label,
                        collapsed or not. */}
                    <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
