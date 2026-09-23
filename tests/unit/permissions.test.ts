import { describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/client";
import { hasPermission, isOrgWideRole, isScopedRole, permissionsForRole } from "@/lib/permissions";

describe("permission engine", () => {
  it("gives OWNER every permission except platform admin", () => {
    expect(hasPermission(Role.OWNER, "canManageBilling")).toBe(true);
    expect(hasPermission(Role.OWNER, "canManageProperties")).toBe(true);
    expect(hasPermission(Role.OWNER, "canAccessPlatformAdmin")).toBe(false);
  });

  it("gives VENDOR issue creation and capture, and nothing else", () => {
    // Capture was added when capture jobs arrived. It is safe to hold because
    // it composes with scope rather than standing alone: a vendor has no
    // property access at all unless a capture job is open on that site (see
    // `propertyScopeWhere`), so the permission reads "may capture, on the
    // sites they were sent to, while the job is open".
    const perms = permissionsForRole(Role.VENDOR);
    expect(perms).toEqual(["canCreateIssues", "canPerformCapture"]);
    expect(hasPermission(Role.VENDOR, "canViewFinancialExposure")).toBe(false);
    expect(hasPermission(Role.VENDOR, "canManageBilling")).toBe(false);
    // The two that would turn a subcontractor into a tenant administrator.
    expect(hasPermission(Role.VENDOR, "canManageProperties")).toBe(false);
    expect(hasPermission(Role.VENDOR, "canManageTeam")).toBe(false);
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

describe("Phase 2 integration permissions", () => {
  it("canPerformCapture covers the capture roles and the vendor, never the viewer", () => {
    expect(hasPermission(Role.INSPECTOR, "canPerformCapture")).toBe(true);
    expect(hasPermission(Role.TECHNICIAN, "canPerformCapture")).toBe(true);
    expect(hasPermission(Role.OWNER, "canPerformCapture")).toBe(true);
    expect(hasPermission(Role.PORTFOLIO_ADMIN, "canPerformCapture")).toBe(true);
    // A capture subcontractor, gated by an open capture job rather than by
    // the permission — see the VENDOR test above.
    expect(hasPermission(Role.VENDOR, "canPerformCapture")).toBe(true);
    // A viewer is read-only and must never gain a write path.
    expect(hasPermission(Role.VIEWER, "canPerformCapture")).toBe(false);
  });

  it("canManageIntegrations (org-level Matterport connect/disconnect) is Owner/Portfolio Admin only", () => {
    expect(hasPermission(Role.OWNER, "canManageIntegrations")).toBe(true);
    expect(hasPermission(Role.PORTFOLIO_ADMIN, "canManageIntegrations")).toBe(true);
    expect(hasPermission(Role.FACILITIES_MANAGER, "canManageIntegrations")).toBe(false);
    expect(hasPermission(Role.TECHNICIAN, "canManageIntegrations")).toBe(false);
    expect(hasPermission(Role.VENDOR, "canManageIntegrations")).toBe(false);
  });
});
