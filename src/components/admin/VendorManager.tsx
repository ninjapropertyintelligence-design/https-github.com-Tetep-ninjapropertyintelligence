"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand";

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => null)) as { data?: Record<string, unknown>; error?: unknown } | null;
  if (!res.ok) {
    return { ok: false as const, error: typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})` };
  }
  return { ok: true as const, data: payload?.data ?? {} };
}

/** Adds a vendor company to the chosen customer. */
export function AddVendorForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await post("/api/v1/admin/vendors", {
        organizationId,
        name,
        trade: trade || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setTrade("");
      setContactEmail("");
      setContactPhone("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        Add vendor company
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-muted">
          Company name
          <input required value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${inputClass}`} />
        </label>
        <label className="block text-xs font-medium text-muted">
          Trade (optional)
          <input
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            placeholder="e.g. Drone capture, Roofing"
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="block text-xs font-medium text-muted">
          Contact email (optional)
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="block text-xs font-medium text-muted">
          Contact phone (optional)
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={`mt-1 ${inputClass}`} />
        </label>
      </div>
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Add vendor"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Gives one of the vendor's people a login.
 *
 * Creates an invitation: the vendor opens the link, sets their own password,
 * and from then on signs in with their email. The link is emailed, and shown
 * here once so it can be passed on directly.
 */
export function VendorLoginForm({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; acceptUrl: string; emailSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await post(`/api/v1/admin/vendors/${vendorId}/logins`, { email, name: name || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreated({
        email: String(result.data.email ?? email),
        acceptUrl: String(result.data.acceptUrl ?? ""),
        emailSent: result.data.emailSent !== false,
      });
      setEmail("");
      setName("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {created ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <p>
            Login created for <strong>{created.email}</strong>.{" "}
            {created.emailSent ? "The sign-up link was emailed to them." : "The email could not be sent — give them this link."}
          </p>
          <p className="mt-1 text-xs">
            They open the link, set a password, then sign in with their email. The link works once, for 7 days.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded bg-white px-2 py-1 text-xs text-foreground">{created.acceptUrl}</code>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(created.acceptUrl);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        </div>
      ) : null}

      {open ? (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <label className="block text-xs font-medium text-muted">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="block text-xs font-medium text-muted">
            Name (optional)
            <input value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${inputClass}`} />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create login"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {error ? <p className="w-full text-sm text-[var(--band-critical)]">{error}</p> : null}
        </form>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)} aria-label={`Create a login for ${vendorName}`}>
          + Create login
        </Button>
      )}
    </div>
  );
}

/** Sends a draft job to its vendor. Issuing is what gives the vendor access to the sites. */
export function IssueJobButton({ jobId, hasVendor }: { jobId: string; hasVendor: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/capture-jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue" }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        setError(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span>This job is a draft. The vendor cannot see it until it is sent.</span>
      <Button type="button" disabled={busy || !hasVendor} onClick={issue}>
        {busy ? "Sending…" : "Send to vendor"}
      </Button>
      {!hasVendor ? <span className="text-xs">Assign a vendor first.</span> : null}
      {error ? <span className="w-full text-[var(--band-critical)]">{error}</span> : null}
    </div>
  );
}
