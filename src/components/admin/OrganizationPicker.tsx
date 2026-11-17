"use client";

import { usePathname, useRouter } from "next/navigation";

/**
 * Chooses the customer organization a platform page works on. The choice
 * lives in the URL (`?org=`), so the page is rendered for it on the server
 * and a link to it opens on the same customer.
 */
export function OrganizationPicker({
  organizations,
  value,
}: {
  organizations: Array<{ id: string; name: string }>;
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="block text-xs font-medium text-muted">
      Customer
      <select
        value={value}
        onChange={(e) => router.push(e.target.value ? `${pathname}?org=${encodeURIComponent(e.target.value)}` : pathname)}
        className="mt-1 block w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
      >
        <option value="">Choose a customer…</option>
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
