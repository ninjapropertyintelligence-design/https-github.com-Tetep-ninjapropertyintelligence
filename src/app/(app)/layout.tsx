import { redirect } from "next/navigation";
import { getSessionContext, can, mfaPolicySatisfied } from "@/lib/session-context";
import { getNavItems } from "@/lib/nav";
import { ROLE_LABELS } from "@/lib/role-labels";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { MfaRequiredGate } from "@/components/security/MfaRequiredGate";
import { ImpersonationBanner } from "@/components/security/ImpersonationBanner";
import { getMfaStatus } from "@/lib/mfa-service";

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

  // Org policy gate (spec §43). Replaces the whole app shell rather than
  // redirecting, so there is no route to slip past and no loop to fall into.
  if (!mfaPolicySatisfied(ctx)) {
    const status = await getMfaStatus(ctx.userId, ctx.organizationId || null);
    return <MfaRequiredGate status={status} orgName={ctx.organizationName} />;
  }

  const navItems = getNavItems(ctx);
  const roleLabel = ctx.isPlatformAdmin && !ctx.organizationId ? "Platform Admin" : ROLE_LABELS[ctx.role];

  // The shell bar spans the full width above the sidebar, rather than sitting
  // beside it: the product identity and global search belong to the whole
  // application, not to the content column.
  return (
    <div className="flex h-screen flex-col">
      {/* Spec §45 "Show visible indicator" — above everything, on every page. */}
      {ctx.impersonation ? (
        <ImpersonationBanner info={ctx.impersonation} organizationName={ctx.organizationName} />
      ) : null}
      <Header userName={ctx.userName} showAI={can(ctx, "canViewAI")} />
      <div className="flex min-h-0 flex-1">
        <Sidebar items={navItems} orgName={ctx.organizationName || "Platform Console"} roleLabel={roleLabel} />
        <main className="min-w-0 flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
