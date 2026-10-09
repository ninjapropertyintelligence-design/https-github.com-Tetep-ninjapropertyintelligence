"use client";

export type ScopeType = "PORTFOLIO" | "REGION" | "PROPERTY";

export interface Option {
  id: string;
  label: string;
}

export interface MembershipOptions {
  roles: Array<{ value: string; label: string }>;
  vendors: Option[];
  scopes: Record<ScopeType, Option[]>;
}

export interface MembershipValue {
  role: string;
  vendorId: string;
  scopeType: ScopeType;
  scopeIds: string[];
}

/** Roles that see nothing without a grant. Mirrors ROLES_NEEDING_GRANTS on the server. */
const SCOPED_ROLES = ["REGIONAL_MANAGER", "FACILITIES_MANAGER", "INSPECTOR", "TECHNICIAN"];

export const memberInputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand";

export function needsScope(role: string) {
  return SCOPED_ROLES.includes(role);
}

/** The request body fields for a role choice: what the server's membership rules expect. */
export function membershipPayload(value: MembershipValue) {
  return {
    role: value.role,
    vendorId: value.role === "VENDOR" ? value.vendorId || null : null,
    grants: needsScope(value.role) ? value.scopeIds.map((id) => ({ scopeType: value.scopeType, id })) : [],
  };
}

/** Whether the choice is complete enough to submit. The server is still the guard. */
export function membershipComplete(value: MembershipValue) {
  if (value.role === "VENDOR") return !!value.vendorId;
  if (needsScope(value.role)) return value.scopeIds.length > 0;
  return !!value.role;
}

/**
 * Role, vendor company and access scope — the part of a membership that an
 * invitation sets and an edit changes. Asks only what the role needs.
 */
export function MembershipFields({
  options,
  value,
  onChange,
}: {
  options: MembershipOptions;
  value: MembershipValue;
  onChange: (next: MembershipValue) => void;
}) {
  const set = (patch: Partial<MembershipValue>) => onChange({ ...value, ...patch });

  return (
    <>
      <label className="block text-xs font-medium text-muted">
        Role
        <select value={value.role} onChange={(e) => set({ role: e.target.value })} className={`mt-1 ${memberInputClass}`}>
          {options.roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      {value.role === "VENDOR" ? (
        <label className="block text-xs font-medium text-muted">
          Vendor company
          <select
            required
            value={value.vendorId}
            onChange={(e) => set({ vendorId: e.target.value })}
            className={`mt-1 ${memberInputClass}`}
          >
            <option value="">Choose a company…</option>
            {options.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block font-normal">Vendors only see the sites on capture jobs sent to their company.</span>
        </label>
      ) : null}

      {needsScope(value.role) ? (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted">
            What can they see?
            <select
              value={value.scopeType}
              onChange={(e) => set({ scopeType: e.target.value as ScopeType, scopeIds: [] })}
              className={`mt-1 ${memberInputClass}`}
            >
              <option value="PROPERTY">Specific properties</option>
              <option value="REGION">Whole regions</option>
              <option value="PORTFOLIO">Whole portfolios</option>
            </select>
          </label>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
            {options.scopes[value.scopeType].length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted">None in this organization yet.</p>
            ) : (
              options.scopes[value.scopeType].map((option) => (
                <label
                  key={option.id}
                  className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-sm text-foreground last:border-0"
                >
                  <input
                    type="checkbox"
                    checked={value.scopeIds.includes(option.id)}
                    onChange={(e) =>
                      set({
                        scopeIds: e.target.checked
                          ? [...value.scopeIds, option.id]
                          : value.scopeIds.filter((x) => x !== option.id),
                      })
                    }
                  />
                  {option.label}
                </label>
              ))
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

