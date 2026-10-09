"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { AuthCard, authInputClass, errorFrom } from "@/components/auth/AuthCard";

export function ResetPasswordForm({ token, minLength }: { token: string; minLength: number }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
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
      <AuthCard subtitle="Password changed">
        <p className="text-sm text-foreground">
          Your password has been changed, and any device that was signed in has been signed out.
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
    <AuthCard subtitle="Choose a new password">
      <form onSubmit={handleSubmit}>
        <label htmlFor="password" className="block text-xs font-medium text-muted">
          New password
        </label>
        <input
          id="password"
          type="password"
          required
          autoFocus
          minLength={minLength}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={authInputClass}
        />
        <label htmlFor="confirm" className="block text-xs font-medium text-muted">
          Confirm new password
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
        {error ? <p className="mb-3 text-sm text-[var(--band-critical)]">{error}</p> : null}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Saving..." : "Set new password"}
        </Button>
      </form>
    </AuthCard>
  );
}
