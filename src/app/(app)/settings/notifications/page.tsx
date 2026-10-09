import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/session-context";
import { NOTIFICATION_CATALOG, getEmailPreferences } from "@/lib/notification-preferences";
import { NotificationPreferencesForm } from "@/components/settings/NotificationPreferencesForm";

/**
 * Personal email settings. Every role reaches it — a vendor decides about
 * their own inbox as much as an Owner does — so there is no permission gate.
 */
export default async function NotificationSettingsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const email = await getEmailPreferences(ctx.userId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Notifications</h1>
        <p className="text-sm text-muted">Emails sent to {ctx.userEmail}</p>
      </div>
      <div className="max-w-3xl">
        <NotificationPreferencesForm catalog={NOTIFICATION_CATALOG} initial={email} />
      </div>
    </div>
  );
}
