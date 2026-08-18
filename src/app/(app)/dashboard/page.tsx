import { redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { getPortfolioDashboard } from "@/lib/dashboard";
import { getFacilitiesActionQueue, getMyFieldWork, getVendorWork } from "@/lib/dashboard-views";
import { PortfolioOverview } from "@/components/dashboard/PortfolioOverview";
import { FacilitiesActionDashboard } from "@/components/dashboard/FacilitiesActionDashboard";
import { FieldWorkDashboard } from "@/components/dashboard/FieldWorkDashboard";
import { VendorDashboard } from "@/components/dashboard/VendorDashboard";
import { prisma } from "@/lib/prisma";

/**
 * Role-based home routing (spec §2, §46 final requirement): the same login
 * flow lands on a completely different dashboard depending on role. All of
 * it reads from the same underlying services (`getPortfolioDashboard`,
 * `getFacilitiesActionQueue`, etc.) — this file only decides which view to
 * render, never recomputes numbers itself.
 */
export default async function DashboardPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  if (ctx.isPlatformAdmin && !ctx.organizationId) {
    redirect("/admin");
  }

  switch (ctx.role) {
    case "OWNER": {
      const data = await getPortfolioDashboard(ctx);
      return <PortfolioOverview data={data} heading="Executive Dashboard" subheading="What is happening across my business?" showAI={can(ctx, "canViewAI")} />;
    }
    case "PORTFOLIO_ADMIN": {
      const data = await getPortfolioDashboard(ctx);
      return <PortfolioOverview data={data} heading="Portfolio Operations" subheading="Portfolio-wide operational status" showAI={can(ctx, "canViewAI")} />;
    }
    case "REGIONAL_MANAGER": {
      const data = await getPortfolioDashboard(ctx);
      return (
        <PortfolioOverview
          data={data}
          heading="Regional Dashboard"
          subheading="What is happening in my region?"
          showAI={can(ctx, "canViewAI")}
        />
      );
    }
    case "VIEWER": {
      const data = await getPortfolioDashboard(ctx);
      return <PortfolioOverview data={data} heading="Portfolio Summary" subheading="Read-only view" showAI={can(ctx, "canViewAI")} />;
    }
    case "FACILITIES_MANAGER": {
      const data = await getFacilitiesActionQueue(ctx);
      return <FacilitiesActionDashboard data={data} showAI={can(ctx, "canViewAI")} />;
    }
    case "INSPECTOR": {
      const data = await getMyFieldWork(ctx);
      return <FieldWorkDashboard data={data} isInspector />;
    }
    case "TECHNICIAN": {
      const data = await getMyFieldWork(ctx);
      return <FieldWorkDashboard data={data} isInspector={false} />;
    }
    case "VENDOR": {
      const data = await getVendorWork(ctx);
      const vendor = ctx.vendorId ? await prisma.vendor.findUnique({ where: { id: ctx.vendorId } }) : null;
      return <VendorDashboard data={data} vendorName={vendor?.name ?? "Vendor Portal"} />;
    }
    default:
      redirect("/properties");
  }
}
