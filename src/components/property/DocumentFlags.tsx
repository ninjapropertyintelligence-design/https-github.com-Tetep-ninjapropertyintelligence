"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/components/settings/api-request";

/** The two "where does this document show up" switches, for a property manager. */
export function DocumentFlags({
  documentId,
  showInInfoTab,
  availableInCapture,
}: {
  documentId: string;
  showInInfoTab: boolean;
  availableInCapture: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function set(patch: Record<string, boolean>) {
    setBusy(true);
    const res = await apiRequest(`/api/v1/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(patch) });
    setBusy(false);
    if (res.ok) router.refresh();
  }
  return (
    <span className="flex items-center gap-3 text-xs text-muted">
      <label className="flex items-center gap-1" title="Listed among key documents on the property Overview">
        <input type="checkbox" disabled={busy} defaultChecked={showInInfoTab} onChange={(e) => set({ showInInfoTab: e.target.checked })} />
        Info tab
      </label>
      <label className="flex items-center gap-1" title="Offered to inspectors as reference on this property's assessments">
        <input
          type="checkbox"
          disabled={busy}
          defaultChecked={availableInCapture}
          onChange={(e) => set({ availableInCapture: e.target.checked })}
        />
        Capture access
      </label>
    </span>
  );
}
