import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { isResetTokenValid, MIN_PASSWORD_LENGTH } from "@/lib/password-reset-service";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  // Said up front, rather than after someone has typed a new password twice.
  if (!token || !(await isResetTokenValid(token))) {
    return (
      <AuthCard subtitle="Link expired">
        <p className="text-sm text-foreground">
          This reset link is invalid or has expired. Links work once, for an hour, and only the newest one you were
          sent.
        </p>
        <Link
          href="/forgot-password"
          className="mt-4 inline-block rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Send a new link
        </Link>
      </AuthCard>
    );
  }

  return <ResetPasswordForm token={token} minLength={MIN_PASSWORD_LENGTH} />;
}
