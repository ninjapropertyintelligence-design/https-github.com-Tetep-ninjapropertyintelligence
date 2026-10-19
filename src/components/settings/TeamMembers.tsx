"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";
import {
  MembershipFields,
  type MembershipOptions,
  type MembershipValue,
  type ScopeType,
  membershipComplete,
  membershipPayload,
} from "@/components/settings/MembershipFields";

export interface TeamMember {
  membershipId: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  vendorId: string | null;
  vendorName: string | null;
  /** The member's current grants, all of one scope type in practice. */
  scopeType: ScopeType;
  scopeIds: string[];
  accessSummary: string | null;
  isSelf: boolean;
  /** Whether this viewer may change or remove this member (Owners only by Owners, never yourself). */
  manageable: boolean;
}

/**
 * The organization's members, with changing a role and removing someone.
 *
 * Edit opens the same role, vendor and access fields an invitation uses,
 * filled with what the member has now. Whatever is saved replaces their
 * access entirely. The server refuses what it must (yourself, the last
 * Owner, an Owner when you are not one) and says why; the buttons are hidden
 * only where the answer is already known.
 */
export function TeamMembers({
  members,
  options,
  canManage,
}: {
  members: TeamMember[];
  options: MembershipOptions;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState<MembershipValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function startEdit(member: TeamMember) {
    setEditing(member.membershipId);
    setError(null);
    setNotice(null);
    setValue({ role: member.role, vendorId: member.vendorId ?? "", scopeType: member.scopeType, scopeIds: member.scopeIds });
  }

  async function save(e: FormEvent, member: TeamMember) {
    e.preventDefault();
    if (!value) return;
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/v1/members/${member.membershipId}`, {
      method: "PATCH",
      body: JSON.stringify(membershipPayload(value)),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(null);
    setNotice(`Updated ${member.name}. The change applies on their next click.`);
    router.refresh();
  }

  async function remove(member: TeamMember) {
    if (
      !window.confirm(
        `Remove ${member.name} (${member.email}) from this organization? They lose access straight away. Their account and history are kept.`,
      )
    ) {
      return;
    }
    setError(null);
    setNotice(null);
    const result = await apiRequest(`/api/v1/members/${member.membershipId}`, { method: "DELETE" });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`Removed ${member.name}.`);
    router.refresh();
  }

  return (
    <div>
      {notice ? <p className="px-5 pt-3 text-sm text-[var(--band-good)]">{notice}</p> : null}
      {error && !editing ? <p className="px-5 pt-3 text-sm text-[var(--band-critical)]">{error}</p> : null}
      <ul>
        {members.map((m) => (
          <li key={m.membershipId} className="border-b border-border px-5 py-2.5 text-sm last:border-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 sm:flex-1">
                <p className="truncate font-medium text-foreground">
                  {m.name}
                  {m.isSelf ? <span className="ml-1.5 text-xs font-normal text-muted">(you)</span> : null}
                </p>
                <p className="truncate text-xs text-muted">{m.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="whitespace-nowrap sm:text-right">
                  <p className="text-xs text-muted">{m.roleLabel}</p>
                  {m.vendorName || m.accessSummary ? (
                    <p className="text-xs text-muted">{m.vendorName ?? m.accessSummary}</p>
                  ) : null}
                </div>
                {canManage && m.manageable && editing !== m.membershipId ? (
                  <>
                    <Button type="button" variant="secondary" onClick={() => startEdit(m)}>
                      Edit
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => remove(m)}>
                      Remove
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            {editing === m.membershipId && value ? (
              <form onSubmit={(e) => save(e, m)} className="mt-3 space-y-3 rounded-lg border border-border p-3">
                <MembershipFields options={options} value={value} onChange={setValue} />
                {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy || !membershipComplete(value)}>
                    {busy ? "Saving…" : "Save changes"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setEditing(null);
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
