import { redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { getPortfolioDashboard } from "@/lib/dashboard";
import { getVendorWork } from "@/lib/dashboard-views";
import { getOperationsDashboard } from "@/lib/ops-dashboard";
import { PortfolioOverview } from "@/components/dashboard/PortfolioOverview";
import { OperationsDashboard } from "@/components/dashboard/OperationsDashboard";
import { VendorDashboard } from "@/components/dashboard/VendorDashboard";
import { prisma } from "@/lib/prisma";
import { recordProductEvent } from "@/lib/analytics";

/**
 * Role-based home routing (spec §2, §46 final requirement): the same login
 * flow lands on a different dashboard depending on role. This file only
 * decides which view to render, never recomputes numbers itself.
 *
 * THREE dashboards, not eight. There were four components under eight
 * headings, which sounds like tailoring and behaved like fragmentation:
 * nobody could answer "is the Midwest sweep going to land on time" without
 * opening three of them, and each one had to be maintained separately.
 *
 * The three are the three parties to the work:
 *
 *   OPERATIONS  — the staff running capture. Jobs in flight, who is on each,
 *                 how far through the route, what is waiting to be reviewed,
 *                 and which subcontractors are free.
 *   VENDOR      — the subcontractor. Their jobs and nothing else.
 *   PROPERTY    — the read-only stakeholder (lender, insurer, board). Health,
 *                 risk and capital exposure; no sight of the crew roster.
 *
 * Roles are untouched: what changed is where they land. Scoping still comes
 * from `propertyScopeWhere`, so a Facilities Manager on the operations screen
 * sees only their own sites' jobs.
 */
export default async function DashboardPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  if (ctx.isPlatformAdmin && !ctx.organizationId) {
    redirect("/admin");
  }

  // Product analytics (§105). After the platform-admin redirect: an admin
  // with no organization has no organizationId to attribute a view to.
  // Awaited but never able to throw, and flagged automatically when the
  // viewer is support impersonating.
  await recordProductEvent(ctx, "dashboard.viewed");

  switch (ctx.role) {
    // The property-owner view: condition, risk and capital exposure — the
    // numbers the building is judged on. Deliberately NOT the crew roster;
    // an owner asks "what is this portfolio worth and what will it cost me",
    // not "which subcontractor is at Store #1052".
    //
    // VIEWER is the read-only role sold to a lender, insurer or board member.
    // An OWNER is NOT this: they run the business as well as owning the
    // buildings, so they land on Operations, which carries the portfolio
    // roll-up at the top for exactly that reason.
    case "VIEWER": {
      const data = await getPortfolioDashboard(ctx);
      return (
        <PortfolioOverview
          data={data}
          heading="Portfolio"
          subheading="Condition, risk and capital exposure"
          showAI={can(ctx, "canViewAI")}
        />
      );
    }

    case "VENDOR": {
      const data = await getVendorWork(ctx);
      const vendor = ctx.vendorId ? await prisma.vendor.findUnique({ where: { id: ctx.vendorId } }) : null;
      return <VendorDashboard data={data} vendorName={vendor?.name ?? "Vendor Portal"} />;
    }

    // Everyone who runs the work. One screen, scoped per role — an Owner and
    // a Portfolio Admin see every job in the org, a Facilities Manager only
    // their own sites' jobs, and all of them are asking the same question.
    // The portfolio roll-up at the top appears for whoever may see the money,
    // so an Owner gets condition and exposure here too rather than losing
    // them to a second page.
    case "OWNER":
    case "PORTFOLIO_ADMIN":
    case "REGIONAL_MANAGER":
    case "FACILITIES_MANAGER":
    case "INSPECTOR":
    case "TECHNICIAN": {
      const data = await getOperationsDashboard(ctx);
      return <OperationsDashboard data={data} canReview={can(ctx, "canManageVendors")} />;
    }

    default:
      redirect("/properties");
  }
}
