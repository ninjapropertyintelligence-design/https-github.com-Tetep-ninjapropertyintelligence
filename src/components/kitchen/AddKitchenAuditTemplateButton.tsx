"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

/** Adds the ready-made restaurant kitchen audit template and opens it. */
export function AddKitchenAuditTemplateButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await apiRequest("/api/v1/assessments/templates/kitchen-audit", { method: "POST" });
          setBusy(false);
          if (!res.ok) {
            setError(res.error);
            return;
          }
          const id = typeof res.data?.id === "string" ? res.data.id : null;
          if (id) router.push(`/assessments/templates/${id}`);
          else router.refresh();
        }}
      >
        {busy ? "Adding…" : "Add restaurant kitchen audit"}
      </Button>
      {error ? <span className="text-xs text-[var(--band-critical)]">{error}</span> : null}
    </span>
  );
}
