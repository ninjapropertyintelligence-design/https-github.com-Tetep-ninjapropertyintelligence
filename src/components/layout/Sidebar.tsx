"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavItem } from "@/lib/nav";

export function Sidebar({ items, orgName, roleLabel }: { items: NavItem[]; orgName: string; roleLabel: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="border-b border-border px-4 py-4">
        <p className="truncate text-sm font-semibold text-foreground">{orgName}</p>
        <p className="text-xs text-muted">{roleLabel}</p>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                active ? "bg-brand/10 text-brand" : "text-foreground/80 hover:bg-zinc-100"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
