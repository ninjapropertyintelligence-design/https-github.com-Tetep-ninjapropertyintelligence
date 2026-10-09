import { AuthCard } from "@/components/auth/AuthCard";
import { AcceptInvitationForm } from "@/components/auth/AcceptInvitationForm";
import { describeInvitation } from "@/lib/invitation-service";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-reset-service";

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const invitation = token ? await describeInvitation(token) : null;

  if (!token || !invitation) {
    return (
      <AuthCard subtitle="Invitation unavailable">
        <p className="text-sm text-foreground">
          This invitation is invalid, has expired, or has already been used. Invitations last 7 days, and only the
          newest one sent to you works. Ask the person who invited you to send a new one.
        </p>
      </AuthCard>
    );
  }

  return <AcceptInvitationForm token={token} invitation={invitation} minLength={MIN_PASSWORD_LENGTH} />;
}
