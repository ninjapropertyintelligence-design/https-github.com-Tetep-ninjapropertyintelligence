import { SessionContext, can } from "@/lib/session-context";

export interface NavItem {
  label: string;
  href: string;
}

/**
 * Role-aware navigation (spec §24-27). Built from the permission engine, not
 * a role name switch — a role gets a nav item because it has the underlying
 * permission, matching "roles should map to permissions" (§40). The backend
 * enforces the same permissions on every route regardless of what the nav
 * shows, so hiding a link here is a UX convenience, never the security
 * boundary.
 */
export function getNavItems(ctx: SessionContext): NavItem[] {
  if (ctx.isPlatformAdmin && !ctx.organizationId) {
    return [{ label: "Platform Administration", href: "/admin" }];
  }

  const items: NavItem[] = [{ label: "Dashboard", href: "/dashboard" }];

  if (can(ctx, "canViewPortfolio")) {
    items.push({ label: "Properties", href: "/properties" });
    items.push({ label: "Map", href: "/map" });
  }
  if (can(ctx, "canManageAssets") || can(ctx, "canViewPortfolio")) {
    items.push({ label: "Assets", href: "/assets" });
  }
  items.push({ label: "Issues", href: "/issues" });
  if (can(ctx, "canPerformAssessments")) {
    items.push({ label: "Assessments", href: "/assessments" });
  }
  if (can(ctx, "canViewFinancialExposure")) {
    items.push({ label: "Reports", href: "/reports" });
  }
  if (can(ctx, "canViewAI")) {
    items.push({ label: "AI", href: "/ai" });
  }
  if (can(ctx, "canManageTeam") || can(ctx, "canManageBilling")) {
    items.push({ label: "Administration", href: "/settings" });
  }
  if (ctx.isPlatformAdmin) {
    items.push({ label: "Platform Admin", href: "/admin" });
  }

  return items;
}
