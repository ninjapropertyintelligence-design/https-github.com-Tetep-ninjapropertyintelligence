"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { AuthCard, authInputClass, errorFrom } from "@/components/auth/AuthCard";

interface InvitationSummary {
  email: string;
  name: string | null;
  roleLabel: string;
  organizationName: string;
  inviterName: string | null;
  hasAccount: boolean;
}

export function AcceptInvitationForm({
  token,
  invitation,
  minLength,
}: {
  token: string;
  invitation: InvitationSummary;
  minLength: number;
}) {
  const [name, setName] = useState(invitation.name ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!invitation.hasAccount && password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invitation.hasAccount ? { token } : { token, name, password }),
      });
      if (!res.ok) {
        setError(await errorFrom(res));
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthCard subtitle="You're in">
        <p className="text-sm text-foreground">
          You have joined <span className="font-medium">{invitation.organizationName}</span>. Sign in with{" "}
          <span className="font-medium">{invitation.email}</span>
          {invitation.hasAccount ? " and your existing password." : " and the password you just chose."}
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard subtitle={`Join ${invitation.organizationName}`}>
      <form onSubmit={handleSubmit}>
        <p className="mb-4 text-sm text-foreground">
          {invitation.inviterName ? `${invitation.inviterName} invited you` : "You have been invited"} to join{" "}
          <span className="font-medium">{invitation.organizationName}</span> as{" "}
          <span className="font-medium">{invitation.roleLabel}</span>.
        </p>
        <label className="block text-xs font-medium text-muted">Email</label>
        <input value={invitation.email} disabled className={`${authInputClass} bg-background text-muted`} />

        {invitation.hasAccount ? (
          <p className="mb-4 text-sm text-muted">
            You already have an account with this email. Accept to add this organization to it; your password stays
            the same.
          </p>
        ) : (
          <>
            <label htmlFor="name" className="block text-xs font-medium text-muted">
              Your name
            </label>
            <input
              id="name"
              required
              autoFocus
              autoComplete="name"
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={authInputClass}
            />
            <label htmlFor="password" className="block text-xs font-medium text-muted">
              Choose a password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={minLength}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={authInputClass}
            />
            <label htmlFor="confirm" className="block text-xs font-medium text-muted">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              required
              minLength={minLength}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={authInputClass}
            />
            <p className="-mt-2 mb-4 text-xs text-muted">At least {minLength} characters.</p>
          </>
        )}

        {error ? <p className="mb-3 text-sm text-[var(--band-critical)]">{error}</p> : null}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Joining..." : invitation.hasAccount ? "Accept invitation" : "Create account and join"}
        </Button>
      </form>
    </AuthCard>
  );
}
