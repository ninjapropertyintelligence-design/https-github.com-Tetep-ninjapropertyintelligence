"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/components/settings/api-request";

/** Names the contractor that services one asset. */
export function AssetContractorPicker({
  assetId,
  currentVendorId,
  options,
}: {
  assetId: string;
  currentVendorId: string | null;
  options: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <select
        value={currentVendorId ?? ""}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError(null);
          const res = await apiRequest(`/api/v1/assets/${assetId}/contractor`, {
            method: "PUT",
            body: JSON.stringify({ vendorId: e.target.value || null }),
          });
          setBusy(false);
          if (res.ok) router.refresh();
          else setError(res.error);
        }}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm"
      >
        <option value="">No contractor assigned</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? <p className="text-xs text-[var(--band-critical)]">{error}</p> : null}
    </div>
  );
}
