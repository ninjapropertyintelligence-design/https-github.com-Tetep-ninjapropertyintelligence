import { Role } from "@/generated/prisma/client";

export const ROLE_LABELS: Record<Role, string> = {
  PLATFORM_ADMIN: "Platform Admin",
  OWNER: "Owner",
  PORTFOLIO_ADMIN: "Portfolio Admin",
  REGIONAL_MANAGER: "Regional Manager",
  FACILITIES_MANAGER: "Facilities Manager",
  INSPECTOR: "Inspector",
  TECHNICIAN: "Technician",
  VENDOR: "Vendor",
  VIEWER: "Viewer",
};
