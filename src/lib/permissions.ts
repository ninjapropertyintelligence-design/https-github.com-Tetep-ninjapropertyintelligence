import { Role } from "@/generated/prisma/client";

/**
 * ONE PERMISSION ENGINE.
 *
 * Roles never get checked directly by feature code — every authorization
 * decision in the app (API routes, server components, UI affordances) goes
 * through `hasPermission()` / `can()` from this file. If a new capability is
 * needed, add a Permission below and map it to roles here, in one place.
 */
export const PERMISSIONS = [
  "canViewPortfolio",
  "canManageProperties",
  "canManageAssets",
  "canCreateIssues",
  "canResolveIssues",
  "canPerformAssessments",
  "canManageAssessmentTemplates",
  "canViewFinancialExposure",
  "canViewAI",
  "canManageTeam",
  "canManageIntegrations",
  "canManageBilling",
  "canExportData",
  "canPerformCapture",
  "canManageDroneJobs",
  "canManageVendors",
  "canViewAuditLogs",
  "canManageFeatureFlags",
  "canAccessPlatformAdmin",
  // Spec §45 "Require authorized support role": impersonating a customer is
  // its own capability, not something every platform admin action implies.
  "canImpersonate",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

/**
 * Capabilities that belong to the platform operator, never to a customer —
 * no org role may hold one, however senior.
 */
export const PLATFORM_ONLY_PERMISSIONS: Permission[] = ["canAccessPlatformAdmin", "canImpersonate"];

// Roles that are implicitly organization-wide: every property in the org is
// in scope without needing explicit AccessGrant rows.
export const ORG_WIDE_ROLES: Role[] = [Role.OWNER, Role.PORTFOLIO_ADMIN, Role.VIEWER];

// Roles that require explicit AccessGrant rows (portfolio/region/property).
// No grants => zero property access. This is the enforcement point behind
// "a Midwest Regional Manager cannot access Texas properties."
export const SCOPED_ROLES: Role[] = [
  Role.REGIONAL_MANAGER,
  Role.FACILITIES_MANAGER,
  Role.INSPECTOR,
  Role.TECHNICIAN,
  Role.VENDOR,
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.PLATFORM_ADMIN]: ["canAccessPlatformAdmin", "canViewAuditLogs", "canManageFeatureFlags", "canImpersonate"],

  // Everything except the two platform-side capabilities. Spelled out as a
  // list rather than "ALL minus one" so adding a platform permission to
  // PERMISSIONS can never silently grant it to every customer's Owner —
  // which is exactly what adding `canImpersonate` did on the first pass.
  [Role.OWNER]: ALL.filter((p) => !PLATFORM_ONLY_PERMISSIONS.includes(p)),

  [Role.PORTFOLIO_ADMIN]: [
    "canViewPortfolio",
    "canManageProperties",
    "canManageAssets",
    "canCreateIssues",
    "canResolveIssues",
    "canPerformAssessments",
    "canManageAssessmentTemplates",
    "canViewFinancialExposure",
    "canViewAI",
    "canManageTeam",
    "canManageIntegrations",
    "canExportData",
    "canPerformCapture",
    "canManageDroneJobs",
    "canManageVendors",
  ],

  [Role.REGIONAL_MANAGER]: [
    "canViewPortfolio",
    "canManageAssets",
    "canCreateIssues",
    "canResolveIssues",
    "canPerformAssessments",
    "canViewFinancialExposure",
    "canViewAI",
    "canExportData",
    "canManageVendors",
  ],

  [Role.FACILITIES_MANAGER]: [
    "canViewPortfolio",
    "canManageAssets",
    "canCreateIssues",
    "canResolveIssues",
    "canPerformAssessments",
    "canViewFinancialExposure",
    "canViewAI",
    "canManageVendors",
  ],

  [Role.INSPECTOR]: [
    "canViewPortfolio",
    "canCreateIssues",
    "canPerformAssessments",
    "canPerformCapture",
  ],

  [Role.TECHNICIAN]: [
    "canViewPortfolio",
    "canManageAssets",
    "canCreateIssues",
    "canPerformAssessments",
    "canPerformCapture",
  ],

  // A capture subcontractor. The permission alone grants nothing: a vendor has
  // no property access unless a capture job is open on that site (see
  // `propertyScopeWhere`), so this composes to "may capture, on the sites they
  // were sent to, while the job is open".
  [Role.VENDOR]: ["canCreateIssues", "canPerformCapture"],

  [Role.VIEWER]: ["canViewPortfolio", "canViewFinancialExposure"],
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

export function isOrgWideRole(role: Role): boolean {
  return ORG_WIDE_ROLES.includes(role);
}

export function isScopedRole(role: Role): boolean {
  return SCOPED_ROLES.includes(role);
}
