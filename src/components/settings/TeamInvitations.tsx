"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";

type ScopeType = "PORTFOLIO" | "REGION" | "PROPERTY";

interface Option {
  id: string;
  label: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  roleLabel: string;
  invitedBy: string | null;
  expiresAt: string;
  expired: boolean;
}

/** Roles that see nothing without a grant. Mirrors ROLES_NEEDING_GRANTS on the server. */
const SCOPED_ROLES = ["REGIONAL_MANAGER", "FACILITIES_MANAGER", "INSPECTOR", "TECHNICIAN"];

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand";

/**
 * Inviting people, and the invitations still waiting on them.
 *
 * The form asks only what the role needs: a vendor company for a vendor, and
 * where they may look for a scoped role. The server enforces the same rules
 * and names what is wrong, so this is guidance, not the guard.
 */
export function TeamInvitations({
  roles,
  vendors,
  scopes,
  pending,
}: {
  roles: Array<{ value: string; label: string }>;
  vendors: Option[];
  scopes: Record<ScopeType, Option[]>;
  pending: PendingInvitation[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState(roles.find((r) => r.value === "VIEWER")?.value ?? roles[0]?.value ?? "");
  const [vendorId, setVendorId] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("PROPERTY");
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const needsScope = SCOPED_ROLES.includes(role);
  const isVendor = role === "VENDOR";

  async function call(url: string, init: RequestInit): Promise<{ ok: boolean; data?: Record<string, unknown> }> {
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    const payload = (await res.json().catch(() => null)) as { data?: Record<string, unknown>; error?: unknown } | null;
    if (!res.ok) {
      setError(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`);
      return { ok: false };
    }
    return { ok: true, data: payload?.data ?? undefined };
  }

  function emailNotice(sent: unknown, address: string) {
    return sent === false
      ? `Invitation saved, but the email to ${address} could not be sent. Check the email settings, then press Resend.`
      : `Invitation sent to ${address}.`;
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { ok, data } = await call("/api/v1/invitations", {
        method: "POST",
        body: JSON.stringify({
          email,
          name: name || null,
          role,
          vendorId: isVendor ? vendorId || null : null,
          grants: needsScope ? scopeIds.map((id) => ({ scopeType, id })) : [],
        }),
      });
      if (!ok) return;
      setNotice(emailNotice(data?.emailSent, email));
      setEmail("");
      setName("");
      setScopeIds([]);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend(invitation: PendingInvitation) {
    setError(null);
    setNotice(null);
    const { ok, data } = await call(`/api/v1/invitations/${invitation.id}`, {
      method: "POST",
      body: JSON.stringify({ action: "resend" }),
    });
    if (ok) {
      setNotice(emailNotice(data?.emailSent, invitation.email));
      router.refresh();
    }
  }

  async function revoke(invitation: PendingInvitation) {
    if (!window.confirm(`Cancel the invitation to ${invitation.email}? The link will stop working.`)) return;
    setError(null);
    setNotice(null);
    const { ok } = await call(`/api/v1/invitations/${invitation.id}`, { method: "DELETE" });
    if (ok) router.refresh();
  }

  return (
    <div className="border-t border-border">
      <div className="flex items-center justify-between px-5 py-3">
        <p className="text-sm font-medium text-foreground">Invitations</p>
        {!open ? (
          <Button type="button" onClick={() => setOpen(true)}>
            Invite member
          </Button>
        ) : null}
      </div>

      {notice ? <p className="px-5 pb-3 text-sm text-[var(--band-good)]">{notice}</p> : null}
      {error && !open ? <p className="px-5 pb-3 text-sm text-[var(--band-critical)]">{error}</p> : null}

      {open ? (
        <form onSubmit={handleInvite} className="space-y-3 border-t border-border px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          </div>

          <label className="block text-xs font-medium text-muted">
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)} className={`mt-1 ${inputClass}`}>
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          {isVendor ? (
            <label className="block text-xs font-medium text-muted">
              Vendor company
              <select
                required
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className={`mt-1 ${inputClass}`}
              >
                <option value="">Choose a company…</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block font-normal">
                Vendors only see the sites on capture jobs sent to their company.
              </span>
            </label>
          ) : null}

          {needsScope ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted">
                What can they see?
                <select
                  value={scopeType}
                  onChange={(e) => {
                    setScopeType(e.target.value as ScopeType);
                    setScopeIds([]);
                  }}
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="PROPERTY">Specific properties</option>
                  <option value="REGION">Whole regions</option>
                  <option value="PORTFOLIO">Whole portfolios</option>
                </select>
              </label>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                {scopes[scopeType].length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted">None in this organization yet.</p>
                ) : (
                  scopes[scopeType].map((option) => (
                    <label
                      key={option.id}
                      className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-sm text-foreground last:border-0"
                    >
                      <input
                        type="checkbox"
                        checked={scopeIds.includes(option.id)}
                        onChange={(e) =>
                          setScopeIds((ids) => (e.target.checked ? [...ids, option.id] : ids.filter((x) => x !== option.id)))
                        }
                      />
                      {option.label}
                    </label>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || (needsScope && scopeIds.length === 0)}>
              {busy ? "Sending…" : "Send invitation"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {pending.length > 0 ? (
        <ul className="border-t border-border">
          {pending.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2.5 text-sm last:border-0">
              <div>
                <p className="font-medium text-foreground">{inv.email}</p>
                <p className="text-xs text-muted">
                  {inv.roleLabel}
                  {inv.invitedBy ? ` · invited by ${inv.invitedBy}` : ""} ·{" "}
                  {inv.expired ? <span className="text-[var(--band-critical)]">expired</span> : `expires ${inv.expiresAt}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => resend(inv)}>
                  Resend
                </Button>
                <Button type="button" variant="ghost" onClick={() => revoke(inv)}>
                  Cancel
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-border px-5 py-3 text-sm text-muted">No pending invitations.</p>
      )}
    </div>
  );
}
