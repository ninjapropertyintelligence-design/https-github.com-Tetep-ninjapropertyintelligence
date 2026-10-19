"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";
import {
  MembershipFields,
  type MembershipOptions,
  type MembershipValue,
  memberInputClass,
  membershipComplete,
  membershipPayload,
} from "@/components/settings/MembershipFields";

export interface PendingInvitation {
  id: string;
  email: string;
  roleLabel: string;
  invitedBy: string | null;
  expiresAt: string;
  expired: boolean;
}

/**
 * Inviting people, and the invitations still waiting on them.
 *
 * The form asks only what the role needs: a vendor company for a vendor, and
 * where they may look for a scoped role. The server enforces the same rules
 * and names what is wrong, so this is guidance, not the guard.
 */
export function TeamInvitations({ options, pending }: { options: MembershipOptions; pending: PendingInvitation[] }) {
  const router = useRouter();
  const emptyMembership = (): MembershipValue => ({
    role: options.roles.find((r) => r.value === "VIEWER")?.value ?? options.roles[0]?.value ?? "",
    vendorId: "",
    scopeType: "PROPERTY",
    scopeIds: [],
  });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [membership, setMembership] = useState<MembershipValue>(emptyMembership);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    const result = await apiRequest("/api/v1/invitations", {
      method: "POST",
      body: JSON.stringify({ email, name: name || null, ...membershipPayload(membership) }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(emailNotice(result.data?.emailSent, email));
    setEmail("");
    setName("");
    setMembership(emptyMembership());
    setOpen(false);
    router.refresh();
  }

  async function resend(invitation: PendingInvitation) {
    setError(null);
    setNotice(null);
    const result = await apiRequest(`/api/v1/invitations/${invitation.id}`, {
      method: "POST",
      body: JSON.stringify({ action: "resend" }),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(emailNotice(result.data?.emailSent, invitation.email));
    router.refresh();
  }

  async function revoke(invitation: PendingInvitation) {
    if (!window.confirm(`Cancel the invitation to ${invitation.email}? The link will stop working.`)) return;
    setError(null);
    setNotice(null);
    const result = await apiRequest(`/api/v1/invitations/${invitation.id}`, { method: "DELETE" });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
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
                className={`mt-1 ${memberInputClass}`}
              />
            </label>
            <label className="block text-xs font-medium text-muted">
              Name (optional)
              <input value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${memberInputClass}`} />
            </label>
          </div>

          <MembershipFields options={options} value={membership} onChange={setMembership} />

          {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !membershipComplete(membership)}>
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
