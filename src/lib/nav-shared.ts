/**
 * The half of the navigation model that is safe in a client bundle.
 *
 * `nav.ts` builds the items and so must import the permission engine, which
 * reaches `next/headers`, Prisma and Node sockets. A client component that
 * imports a *value* from there drags that whole graph into the browser
 * bundle and the build fails on `Can't resolve 'net'`. Types erase, values do
 * not — so the shapes and the pure grouping helper live here, and the
 * sidebar imports only from this file.
 */

/**
 * Sections group the nav the way the work divides: looking at the portfolio,
 * acting on it, reading conclusions from it, and running the platform. Order
 * here is the order they render.
 */
export const NAV_SECTIONS = ["Explore", "Manage", "Insights", "Administration"] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

/** Icon keys resolved to SVG by the sidebar. A key with no drawing falls back to a dot. */
export type NavIconKey =
  | "dashboard"
  | "map"
  | "building"
  | "asset"
  | "issue"
  | "assessment"
  | "import"
  | "capture"
  | "report"
  | "cost"
  | "ai"
  | "settings"
  | "shield"
  | "webhook"
  | "retention"
  | "storage"
  | "usage"
  | "platform";

export interface NavItem {
  label: string;
  href: string;
  section: NavSection;
  icon: NavIconKey;
}

/** Groups items for rendering, dropping sections a role has no items in. */
export function groupNavItems(items: NavItem[]): Array<{ section: NavSection; items: NavItem[] }> {
  return NAV_SECTIONS.map((section) => ({ section, items: items.filter((i) => i.section === section) })).filter(
    (g) => g.items.length > 0,
  );
}
