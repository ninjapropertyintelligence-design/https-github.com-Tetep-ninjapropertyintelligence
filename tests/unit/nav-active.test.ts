import { describe, expect, it } from "vitest";
import { activeNavHref, NavItem } from "@/lib/nav-shared";

const item = (href: string): NavItem => ({ label: href, href, section: "Insights", icon: "report" });
const items = ["/dashboard", "/reports", "/reports/cogs", "/settings", "/settings/security", "/settings/webhooks"].map(item);

describe("activeNavHref", () => {
  it("lights only the most specific item for a nested page", () => {
    expect(activeNavHref(items, "/reports/cogs")).toBe("/reports/cogs");
    expect(activeNavHref(items, "/settings/security")).toBe("/settings/security");
  });

  it("falls back to the parent item for a page with no item of its own", () => {
    expect(activeNavHref(items, "/settings/members/abc")).toBe("/settings");
    expect(activeNavHref(items, "/reports")).toBe("/reports");
  });

  it("does not treat a shared prefix as a parent", () => {
    expect(activeNavHref(items, "/reportsx")).toBeNull();
  });
});
