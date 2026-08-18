"use client";

import { FormEvent, Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";

const DEMO_ACCOUNTS = [
  { email: "owner@demo.com", label: "Owner — Executive dashboard" },
  { email: "portfolioadmin@demo.com", label: "Portfolio Admin — Operations" },
  { email: "regionalmanager@demo.com", label: "Regional Manager — Midwest only" },
  { email: "facilitiesmanager@demo.com", label: "Facilities Manager — Store #1052" },
  { email: "inspector@demo.com", label: "Inspector — Store #1052" },
  { email: "technician@demo.com", label: "Technician — Store #1052" },
  { email: "vendor@demo.com", label: "Vendor — ABC Roofing" },
  { email: "viewer@demo.com", label: "Viewer — read-only" },
  { email: "platformadmin@demo.com", label: "Platform Admin — internal console" },
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("owner@demo.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (result?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push(params.get("callbackUrl") ?? "/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Property Intelligence Platform</h1>
          <p className="mt-1 text-sm text-muted">Sign in to your organization</p>
        </div>
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <label className="block text-xs font-medium text-muted">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 mb-4 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <label className="block text-xs font-medium text-muted">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 mb-4 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
          />
          {error ? <p className="mb-3 text-sm text-[var(--band-critical)]">{error}</p> : null}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <div className="mt-6 rounded-xl border border-dashed border-border p-4">
          <p className="mb-2 text-xs font-medium text-muted">Demo accounts (password: password123)</p>
          <div className="flex flex-col gap-1">
            {DEMO_ACCOUNTS.map((acct) => (
              <button
                key={acct.email}
                type="button"
                onClick={() => setEmail(acct.email)}
                className="rounded-md px-2 py-1 text-left text-xs text-muted hover:bg-zinc-50 hover:text-foreground"
              >
                <span className="font-mono">{acct.email}</span> — {acct.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
