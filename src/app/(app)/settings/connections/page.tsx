import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/session-context";
import { listVendorConnections } from "@/lib/vendor-connection-service";
import { VendorConnectionsPanel } from "@/components/capture/VendorConnectionsPanel";
import { Role } from "@/generated/prisma/client";

/**
 * A vendor connecting its own DroneDeploy and Matterport accounts, so its
 * people can pick a flight or a scan on a job instead of re-uploading it.
 */
export default async function ConnectionsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== Role.VENDOR || !ctx.vendorId) redirect("/dashboard");

  const connections = await listVendorConnections(ctx);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Connections</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Connect your company&apos;s own accounts. Then, on each job site, choose the flight or scan to deliver
          instead of downloading and uploading it again. Everything you bring in is reviewed by the platform team
          before the customer sees it.
        </p>
      </div>
      <VendorConnectionsPanel
        initial={connections.map((c) => ({ ...c, connectedAt: c.connectedAt ? c.connectedAt.toISOString() : null }))}
      />
      <div className="max-w-2xl rounded-xl border border-border bg-surface p-5 text-sm text-muted">
        <p className="font-semibold text-foreground">Insta360</p>
        <p className="mt-1">
          Insta360 does not offer a sign-in that other apps can use to fetch your files. Upload 360° photos straight
          from the camera&apos;s SD card or a folder on the job page instead — each photo is matched to its shot
          position by its GPS.
        </p>
      </div>
    </div>
  );
}
