"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { AuthCard, authInputClass, errorFrom } from "@/components/auth/AuthCard";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        setError(await errorFrom(res));
        return;
      }
      setSent(true);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthCard subtitle="Check your email">
        {/* Worded so it says nothing about whether the address has an account. */}
        <p className="text-sm text-foreground">
          If <span className="font-medium">{email}</span> has an account, we have sent it a link to choose a new
          password. The link works once and expires in an hour.
        </p>
        <p className="mt-3 text-sm text-muted">Nothing arrived? Check your spam folder, or try again in a few minutes.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard subtitle="Reset your password">
      <form onSubmit={handleSubmit}>
        <p className="mb-4 text-sm text-muted">Enter the email you sign in with and we will send you a reset link.</p>
        <label htmlFor="email" className="block text-xs font-medium text-muted">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={authInputClass}
        />
        {error ? <p className="mb-3 text-sm text-[var(--band-critical)]">{error}</p> : null}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Sending..." : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  );
}
