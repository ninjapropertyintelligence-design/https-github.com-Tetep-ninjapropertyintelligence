import { describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/client";
import { hasPermission, isOrgWideRole, isScopedRole, permissionsForRole } from "@/lib/permissions";

describe("permission engine", () => {
  it("gives OWNER every permission except platform admin", () => {
    expect(hasPermission(Role.OWNER, "canManageBilling")).toBe(true);
    expect(hasPermission(Role.OWNER, "canManageProperties")).toBe(true);
    expect(hasPermission(Role.OWNER, "canAccessPlatformAdmin")).toBe(false);
  });

  it("gives VENDOR only issue creation, nothing else", () => {
    const perms = permissionsForRole(Role.VENDOR);
    expect(perms).toEqual(["canCreateIssues"]);
    expect(hasPermission(Role.VENDOR, "canViewFinancialExposure")).toBe(false);
    expect(hasPermission(Role.VENDOR, "canManageBilling")).toBe(false);
  });

  it("gives VIEWER read-only access with no mutation permissions", () => {
    expect(hasPermission(Role.VIEWER, "canViewPortfolio")).toBe(true);
    expect(hasPermission(Role.VIEWER, "canManageAssets")).toBe(false);
    expect(hasPermission(Role.VIEWER, "canCreateIssues")).toBe(false);
  });

  it("classifies org-wide vs scoped roles per spec (regional manager must be scoped)", () => {
    expect(isOrgWideRole(Role.OWNER)).toBe(true);
    expect(isOrgWideRole(Role.PORTFOLIO_ADMIN)).toBe(true);
    expect(isScopedRole(Role.REGIONAL_MANAGER)).toBe(true);
    expect(isScopedRole(Role.FACILITIES_MANAGER)).toBe(true);
    expect(isScopedRole(Role.VENDOR)).toBe(true);
    expect(isOrgWideRole(Role.REGIONAL_MANAGER)).toBe(false);
  });

  it("PLATFORM_ADMIN has no ordinary org data permissions by default", () => {
    expect(hasPermission(Role.PLATFORM_ADMIN, "canManageProperties")).toBe(false);
    expect(hasPermission(Role.PLATFORM_ADMIN, "canAccessPlatformAdmin")).toBe(true);
  });
});
