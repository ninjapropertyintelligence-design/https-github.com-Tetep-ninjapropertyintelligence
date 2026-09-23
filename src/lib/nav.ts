import { SessionContext, can } from "@/lib/session-context";
import { NavItem } from "@/lib/nav-shared";

// Re-exported so server callers keep a single import site for the nav model.
export { NAV_SECTIONS, groupNavItems } from "@/lib/nav-shared";
export type { NavItem, NavSection, NavIconKey } from "@/lib/nav-shared";

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
    return [
      { label: "Platform Administration", href: "/admin", section: "Administration", icon: "platform" },
      { label: "Security", href: "/settings/security", section: "Administration", icon: "shield" },
    ];
  }

  const items: NavItem[] = [{ label: "Dashboard", href: "/dashboard", section: "Explore", icon: "dashboard" }];

  if (can(ctx, "canViewPortfolio")) {
    items.push({ label: "Map", href: "/map", section: "Explore", icon: "map" });
    items.push({ label: "Properties", href: "/properties", section: "Explore", icon: "building" });
  }
  if (can(ctx, "canManageAssets") || can(ctx, "canViewPortfolio")) {
    items.push({ label: "Assets", href: "/assets", section: "Manage", icon: "asset" });
  }
  items.push({ label: "Issues", href: "/issues", section: "Manage", icon: "issue" });
  if (can(ctx, "canPerformAssessments")) {
    items.push({ label: "Assessments", href: "/assessments", section: "Manage", icon: "assessment" });
  }
  if (can(ctx, "canManageProperties")) {
    items.push({ label: "Import", href: "/imports", section: "Manage", icon: "import" });
  }
  // Capture subcontractors reach the product through this one page and
  // nothing else, so it is offered on `canPerformCapture` rather than on a
  // management permission they will never hold.
  if (can(ctx, "canPerformCapture")) {
    items.push({ label: "Capture Jobs", href: "/capture-jobs", section: "Manage", icon: "capture" });
  }
  if (can(ctx, "canViewFinancialExposure")) {
    items.push({ label: "Reports", href: "/reports", section: "Insights", icon: "report" });
    items.push({ label: "Cost to Serve", href: "/reports/cogs", section: "Insights", icon: "cost" });
  }
  if (can(ctx, "canViewAI")) {
    items.push({ label: "AI", href: "/ai", section: "Insights", icon: "ai" });
  }
  if (can(ctx, "canManageTeam") || can(ctx, "canManageBilling")) {
    items.push({ label: "Administration", href: "/settings", section: "Administration", icon: "settings" });
  }
  // Every role can manage its own second factor, so this is not permission-gated.
  items.push({ label: "Security", href: "/settings/security", section: "Administration", icon: "shield" });
  if (can(ctx, "canManageIntegrations")) {
    items.push({ label: "Webhooks", href: "/settings/webhooks", section: "Administration", icon: "webhook" });
  }
  if (can(ctx, "canViewAuditLogs")) {
    items.push({ label: "Retention", href: "/settings/retention", section: "Administration", icon: "retention" });
    items.push({ label: "Storage", href: "/settings/storage", section: "Administration", icon: "storage" });
    items.push({ label: "Product Usage", href: "/settings/usage", section: "Administration", icon: "usage" });
  }
  if (ctx.isPlatformAdmin) {
    items.push({ label: "Platform Admin", href: "/admin", section: "Administration", icon: "platform" });
  }

  return items;
}
