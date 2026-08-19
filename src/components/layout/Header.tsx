"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { apiFetch } from "@/lib/api-client";

interface SearchResult {
  kind: string;
  id: string;
  label: string;
  sublabel: string;
  href: string;
}

interface NotificationItem {
  id: string;
  title: string;
  body?: string | null;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

export function Header({ userName, showAI }: { userName: string; showAI: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiFetch<{ items: NotificationItem[]; unreadCount: number }>("/api/v1/notifications")
      .then((data) => {
        setNotifications(data.items ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      })
      .catch(() => {});
  }, []);

  function handleSearchChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      setSearchOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await apiFetch<{ results: SearchResult[] }>(`/api/v1/search?q=${encodeURIComponent(value)}`);
        setResults(data.results ?? []);
        setSearchOpen(true);
      } catch {
        // Search is best-effort from the header — leave prior results in place.
      }
    }, 250);
  }

  async function markAllRead() {
    const ids = notifications.filter((n) => !n.isRead).map((n) => n.id);
    if (!ids.length) return;
    await fetch("/api/v1/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
      <Link href="/dashboard" className="shrink-0 text-sm font-semibold text-foreground">
        PropIntel
      </Link>

      <div className="relative flex-1 max-w-md">
        <input
          value={query}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => results.length > 0 && setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          placeholder="Search properties, assets, issues..."
          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-brand"
        />
        {searchOpen && results.length > 0 ? (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-96 overflow-auto rounded-lg border border-border bg-surface shadow-lg">
            {results.map((r) => (
              <Link
                key={`${r.kind}-${r.id}`}
                href={r.href}
                className="block border-b border-border px-3 py-2 text-sm last:border-0 hover:bg-zinc-50"
              >
                <span className="text-xs uppercase tracking-wide text-muted">{r.kind}</span>
                <p className="font-medium text-foreground">{r.label}</p>
                <p className="text-xs text-muted">{r.sublabel}</p>
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {showAI ? (
          <Link href="/ai" className="rounded-lg bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/20">
            Ask AI
          </Link>
        ) : null}

        <div className="relative">
          <button
            onClick={() => {
              setNotifOpen((o) => !o);
              if (!notifOpen) markAllRead();
            }}
            className="relative rounded-lg p-2 text-muted hover:bg-zinc-100"
            aria-label="Notifications"
          >
            🔔
            {unreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--band-critical)] text-[10px] font-medium text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </button>
          {notifOpen ? (
            <div className="absolute right-0 top-full z-20 mt-1 w-80 max-h-96 overflow-auto rounded-lg border border-border bg-surface shadow-lg">
              {notifications.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-muted">No notifications yet</p>
              ) : (
                notifications.map((n) => (
                  <Link
                    key={n.id}
                    href={n.link ?? "#"}
                    className="block border-b border-border px-3 py-2 text-sm last:border-0 hover:bg-zinc-50"
                    onClick={() => setNotifOpen(false)}
                  >
                    <p className="font-medium text-foreground">{n.title}</p>
                    {n.body ? <p className="text-xs text-muted">{n.body}</p> : null}
                  </Link>
                ))
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground">{userName}</span>
          <button
            onClick={() => {
              signOut({ redirect: false }).then(() => router.push("/login"));
            }}
            className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-zinc-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
