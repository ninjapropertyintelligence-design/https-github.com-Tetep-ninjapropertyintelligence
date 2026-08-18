import { redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { getNavItems } from "@/lib/nav";
import { ROLE_LABELS } from "@/lib/role-labels";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

// Every route under this layout requires a resolved session. This is the
// server-side auth guard — the same session context also drives which nav
// items render, but the *data* on every page is independently re-scoped by
// each API route / server component, so hiding a nav link is never the only
// thing standing between a role and data it shouldn't see.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) {
    redirect("/login");
  }

  const navItems = getNavItems(ctx);
  const roleLabel = ctx.isPlatformAdmin && !ctx.organizationId ? "Platform Admin" : ROLE_LABELS[ctx.role];

  return (
    <div className="flex min-h-screen">
      <Sidebar items={navItems} orgName={ctx.organizationName || "Platform Console"} roleLabel={roleLabel} />
      <div className="flex min-h-screen flex-1 flex-col">
        <Header userName={ctx.userName} showAI={can(ctx, "canViewAI")} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
